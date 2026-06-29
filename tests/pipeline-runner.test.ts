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
});
