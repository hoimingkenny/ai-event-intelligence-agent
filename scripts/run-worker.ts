import { QUEUE_NAMES, type QueueName } from '../src/queue/jobs.js';
import { startPipelineWorker } from '../src/queue/workers/pipeline-worker.js';

const queueName = process.argv[2] as QueueName | undefined;

if (!queueName || !QUEUE_NAMES.includes(queueName)) {
  console.error(`Usage: npm run worker -- ${QUEUE_NAMES.join('|')}`);
  process.exit(1);
}

const worker = startPipelineWorker(queueName);
console.log(`Worker started for ${queueName}`);

process.on('SIGINT', async () => {
  await worker.close();
  process.exit(0);
});
