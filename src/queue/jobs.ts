export const QUEUE_NAMES = [
  'ingest-queue',
  'extraction-queue',
  'detection-queue',
  'embedding-queue',
  'dedup-queue',
  'event-queue',
  'llm-queue',
  'alert-queue',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export type PipelineJob =
  | { name: 'ingest-feed'; feedId: string }
  | { name: 'extract-article'; articleId: string }
  | { name: 'detect-entities'; articleId: string }
  | { name: 'embed-article'; articleId: string }
  | { name: 'deduplicate-article'; articleId: string }
  | { name: 'group-event'; articleId: string }
  | { name: 'classify-event'; eventId: string }
  | { name: 'decide-alert'; eventId: string };

export function nextQueueForJob(job: PipelineJob): QueueName {
  switch (job.name) {
    case 'ingest-feed':
      return 'extraction-queue';
    case 'extract-article':
      return 'detection-queue';
    case 'detect-entities':
      return 'embedding-queue';
    case 'embed-article':
      return 'dedup-queue';
    case 'deduplicate-article':
      return 'event-queue';
    case 'group-event':
      return 'llm-queue';
    case 'classify-event':
      return 'alert-queue';
    case 'decide-alert':
      return 'alert-queue';
  }
}
