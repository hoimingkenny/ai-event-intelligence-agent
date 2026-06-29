import type { Job } from 'bullmq';
import { getDatabasePool } from '../../db/pool.js';
import type { Queryable } from '../../db/repositories/types.js';
import { runAlertStage } from '../../pipeline/alert-stage.js';
import { runClassificationStage } from '../../pipeline/classification-stage.js';
import { runDedupStage } from '../../pipeline/dedup-stage.js';
import { runEmbeddingStage } from '../../pipeline/embedding-stage.js';
import { runEntityStage } from '../../pipeline/entity-stage.js';
import { runEventStage } from '../../pipeline/event-stage.js';
import { runExtractionStage } from '../../pipeline/extraction-stage.js';
import { ingestRssFeeds } from '../../pipeline/ingest-stage.js';
import { createPipelineWorker } from '../queue.js';
import type { PipelineJob, QueueName } from '../jobs.js';

export async function processPipelineJob(db: Queryable, job: PipelineJob): Promise<unknown> {
  switch (job.name) {
    case 'ingest-feed':
      return ingestRssFeeds(db, { limitFeeds: 1 });
    case 'extract-article':
      return runExtractionStage(db, { limit: 1 });
    case 'detect-entities':
      return runEntityStage(db, { limit: 1 });
    case 'embed-article':
      return runEmbeddingStage(db, { limit: 1 });
    case 'deduplicate-article':
      return runDedupStage(db, { limit: 1 });
    case 'group-event':
      return runEventStage(db, { limit: 1 });
    case 'classify-event':
      return runClassificationStage(db, { limit: 1 });
    case 'decide-alert':
      return runAlertStage(db, { limit: 1 });
  }
}

export function startPipelineWorker(queueName: QueueName) {
  const pool = getDatabasePool();
  const worker = createPipelineWorker(queueName, async (job: Job<PipelineJob>) =>
    processPipelineJob(pool, job.data)
  );

  worker.on('closed', async () => {
    await pool.end();
  });

  return worker;
}
