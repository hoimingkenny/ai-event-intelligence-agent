import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline/runner.js';
import type { Queryable } from '../src/db/repositories/types.js';

class EmptyDb implements Queryable {
  async query<T = unknown>(): Promise<{ rows: T[]; rowCount: number }> {
    return { rows: [], rowCount: 0 };
  }
}

describe('runPipeline', () => {
  it('runs bounded stages without requiring LLM calls', async () => {
    const result = await runPipeline(new EmptyDb(), {
      limit: 1,
      includeIngest: false,
      includeLlm: false,
    });

    expect(result.filter.reviewed).toBe(0);
    expect(result.classification).toBeUndefined();
    expect(result.alerts.reviewed).toBe(0);
  });

  it('takes the classification edge when LLM is enabled', async () => {
    // EmptyDb yields no candidates, so the classification node runs without
    // making any LLM calls — this asserts the conditional edge routing only.
    const result = await runPipeline(new EmptyDb(), {
      limit: 1,
      includeIngest: false,
      includeLlm: true,
    });

    expect(result.classification).toEqual({ reviewed: 0, classified: 0, failed: 0, eventsUpdated: 0, vendorsReconciled: 0 });
    expect(result.alerts.reviewed).toBe(0);
  });

  it('skips ingest when includeIngest is false', async () => {
    const result = await runPipeline(new EmptyDb(), { limit: 1, includeIngest: false });
    expect(result.ingest).toBeUndefined();
  });
});
