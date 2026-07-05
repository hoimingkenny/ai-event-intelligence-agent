import { describe, expect, it } from 'vitest';
import { defaultJobOptions, redisConnection } from '../src/queue/queue.js';
import { processPipelineJob } from '../src/queue/workers/pipeline-worker.js';
import type { Queryable } from '../src/db/repositories/types.js';

class EmptyDb implements Queryable {
  async query<T = unknown>(): Promise<{ rows: T[]; rowCount: number }> {
    return { rows: [], rowCount: 0 };
  }
}

describe('queue workers', () => {
  it('configures retryable jobs', () => {
    expect(defaultJobOptions.attempts).toBe(3);
    expect(defaultJobOptions.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('builds Redis connection settings from env defaults', () => {
    expect(redisConnection()).toMatchObject({ host: 'localhost', port: 6379 });
  });

  it('processes a worker job through the matching stage', async () => {
    const result = await processPipelineJob(new EmptyDb(), {
      name: 'decide-alert',
      eventId: '1',
    });

    expect(result).toMatchObject({ reviewed: 0, sent: 0, suppressed: 0 });
  });
});
