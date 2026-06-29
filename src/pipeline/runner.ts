import { env } from '../config/env.js';
import type { Queryable } from '../db/repositories/types.js';
import { logInfo } from '../utils/logger.js';
import { recordStageResult } from '../utils/metrics.js';
import { runAlertStage } from './alert-stage.js';
import { runClassificationStage } from './classification-stage.js';
import { runDedupStage } from './dedup-stage.js';
import { runEmbeddingStage } from './embedding-stage.js';
import { runEntityStage } from './entity-stage.js';
import { runEventEmbeddingStage } from './event-embedding-stage.js';
import { runEventStage } from './event-stage.js';
import { runExtractionStage } from './extraction-stage.js';
import { runCheapFilterStage } from './filter-stage.js';
import { ingestRssFeeds } from './ingest-stage.js';

export interface PipelineRunOptions {
  limit?: number;
  includeIngest?: boolean;
  includeLlm?: boolean;
}

export interface PipelineRunResult {
  ingest?: Awaited<ReturnType<typeof ingestRssFeeds>>;
  filter: Awaited<ReturnType<typeof runCheapFilterStage>>;
  extraction: Awaited<ReturnType<typeof runExtractionStage>>;
  entities: Awaited<ReturnType<typeof runEntityStage>>;
  articleEmbeddings: Awaited<ReturnType<typeof runEmbeddingStage>>;
  dedup: Awaited<ReturnType<typeof runDedupStage>>;
  events: Awaited<ReturnType<typeof runEventStage>>;
  eventEmbeddings: Awaited<ReturnType<typeof runEventEmbeddingStage>>;
  classification?: Awaited<ReturnType<typeof runClassificationStage>>;
  alerts: Awaited<ReturnType<typeof runAlertStage>>;
}

export async function runPipeline(
  db: Queryable,
  options: PipelineRunOptions = {}
): Promise<PipelineRunResult> {
  const limit = options.limit ?? 20;
  const includeLlm = options.includeLlm ?? Boolean(env.minimaxApiKey);
  const ingest = options.includeIngest === false ? undefined : await ingestRssFeeds(db, { limitFeeds: limit });
  if (ingest) recordAndLog('ingest', ingest);
  const filter = await runCheapFilterStage(db, { limit });
  recordAndLog('filter', filter);
  const extraction = await runExtractionStage(db, { limit });
  recordAndLog('extraction', extraction);
  const entities = await runEntityStage(db, { limit });
  recordAndLog('entities', entities);
  const articleEmbeddings = await runEmbeddingStage(db, { limit });
  recordAndLog('article_embeddings', articleEmbeddings);
  const dedup = await runDedupStage(db, { limit });
  recordAndLog('dedup', dedup);
  const events = await runEventStage(db, { limit });
  recordAndLog('events', events);
  const eventEmbeddings = await runEventEmbeddingStage(db, { limit });
  recordAndLog('event_embeddings', eventEmbeddings);
  const classification = includeLlm ? await runClassificationStage(db, { limit }) : undefined;
  if (classification) recordAndLog('classification', classification);
  const alerts = await runAlertStage(db, { limit });
  recordAndLog('alerts', alerts);

  return {
    ingest,
    filter,
    extraction,
    entities,
    articleEmbeddings,
    dedup,
    events,
    eventEmbeddings,
    classification,
    alerts,
  };
}

function recordAndLog(stageName: string, result: object): void {
  recordStageResult(stageName, result);
  logInfo({ stage: stageName, result }, 'pipeline_stage_completed');
}
