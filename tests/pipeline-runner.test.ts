import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline/runner.js';
import type { Queryable } from '../src/db/repositories/types.js';

class EmptyDb implements Queryable {
  async query<T = unknown>(): Promise<{ rows: T[]; rowCount: number }> {
    return { rows: [], rowCount: 0 };
  }
}

describe('runPipeline', () => {
  it('defaults to cve-mvp and stops after the analysis-task stage without clustering stages', async () => {
    const result = await runPipeline(new EmptyDb(), {
      limit: 1,
      includeIngest: false,
      includeLlm: false,
    });

    expect(result.filter.reviewed).toBe(0);
    expect(result.cveScan).toEqual({ reviewed: 0, withMentions: 0, totalMentions: 0, failed: 0 });
    expect(result.analysisTasks).toEqual({
      articlesReviewed: 0,
      tasksScheduled: 0,
      tasksCompleted: 0,
      tasksExhausted: 0,
      tasksFailed: 0,
    });
    expect(result.digest).toBeUndefined();
    expect(result.classification).toBeUndefined();
    expect(result.alerts).toBeUndefined();
    expect(result.articleEmbeddings).toBeUndefined();
    expect(result.events).toBeUndefined();
  });

  it('keeps the legacy analyst-eval branch selectable and stops after digest', async () => {
    const result = await runPipeline(new EmptyDb(), {
      limit: 1,
      includeIngest: false,
      includeLlm: false,
      profile: 'analyst-eval',
    });

    expect(result.filter.reviewed).toBe(0);
    expect(result.digest).toEqual({ reviewed: 0, digested: 0, skipped: 0, failed: 0 });
    expect(result.cveScan).toBeUndefined();
    expect(result.analysisTasks).toBeUndefined();
    expect(result.classification).toBeUndefined();
    expect(result.alerts).toBeUndefined();
    expect(result.articleEmbeddings).toBeUndefined();
    expect(result.events).toBeUndefined();
  });

  it('runs the full clustering path when profile is full and LLM is enabled', async () => {
    const result = await runPipeline(new EmptyDb(), {
      limit: 1,
      includeIngest: false,
      includeLlm: true,
      profile: 'full',
    });

    expect(result.classification).toEqual({
      reviewed: 0,
      classified: 0,
      failed: 0,
      eventsUpdated: 0,
      vendorsReconciled: 0,
    });
    expect(result.summaries).toEqual({ reviewed: 0, summarized: 0, failed: 0 });
    expect(result.alerts?.reviewed).toBe(0);
    expect(result.digest).toEqual({ reviewed: 0, digested: 0, skipped: 0, failed: 0 });
  });

  it('skips ingest when includeIngest is false', async () => {
    const result = await runPipeline(new EmptyDb(), { limit: 1, includeIngest: false });
    expect(result.ingest).toBeUndefined();
  });
});
