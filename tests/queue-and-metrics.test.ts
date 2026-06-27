import { describe, expect, it } from 'vitest';
import { nextQueueForJob, QUEUE_NAMES } from '../src/queue/jobs.js';
import { MetricsCollector } from '../src/utils/metrics.js';

describe('queue job contracts', () => {
  it('defines expected pipeline queues', () => {
    expect(QUEUE_NAMES).toContain('ingest-queue');
    expect(QUEUE_NAMES).toContain('alert-queue');
  });

  it('maps jobs to the next queue', () => {
    expect(nextQueueForJob({ name: 'extract-article', articleId: '1' })).toBe('detection-queue');
    expect(nextQueueForJob({ name: 'classify-event', eventId: '1' })).toBe('alert-queue');
  });
});

describe('MetricsCollector', () => {
  it('increments and snapshots counters', () => {
    const metrics = new MetricsCollector();
    metrics.increment('articles_created_total');
    metrics.increment('articles_created_total', 2);

    expect(metrics.snapshot()).toEqual({ articles_created_total: 3 });
  });
});
