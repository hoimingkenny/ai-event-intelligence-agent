import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

// runPipeline is mocked so the scheduled wrapper can be tested for its
// locking/skip behaviour without a database or the real pipeline.
const runPipeline = vi.fn();
vi.mock('../src/pipeline/runner.js', () => ({ runPipeline }));

const { runScheduledPipeline, PIPELINE_ADVISORY_LOCK_KEY } = await import(
  '../src/pipeline/scheduled-run.js'
);

interface FakeClientOptions {
  locked: boolean;
  onQuery?: (sql: string) => void;
}

function fakePool(options: FakeClientOptions): { pool: pg.Pool; released: () => boolean; unlocked: () => boolean } {
  let released = false;
  let unlocked = false;
  const client = {
    async query(sql: string) {
      options.onQuery?.(sql);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: options.locked }] };
      if (sql.includes('pg_advisory_unlock')) {
        unlocked = true;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  return { pool, released: () => released, unlocked: () => unlocked };
}

describe('runScheduledPipeline', () => {
  it('runs the pipeline when the advisory lock is acquired, then unlocks and releases', async () => {
    runPipeline.mockResolvedValueOnce({ alerts: { reviewed: 0 } });
    const { pool, released, unlocked } = fakePool({ locked: true });

    const outcome = await runScheduledPipeline(pool, { limit: 5 });

    expect(outcome.ran).toBe(true);
    expect(runPipeline).toHaveBeenCalledWith(pool, { limit: 5 });
    expect(unlocked()).toBe(true);
    expect(released()).toBe(true);
  });

  it('skips (does not run) when the lock is already held', async () => {
    runPipeline.mockClear();
    const { pool, released } = fakePool({ locked: false });

    const outcome = await runScheduledPipeline(pool, {});

    expect(outcome).toMatchObject({ ran: false, reason: 'locked' });
    expect(runPipeline).not.toHaveBeenCalled();
    expect(released()).toBe(true); // connection still returned to the pool
  });

  it('releases the lock even when the pipeline throws', async () => {
    runPipeline.mockRejectedValueOnce(new Error('stage boom'));
    const { pool, unlocked, released } = fakePool({ locked: true });

    const outcome = await runScheduledPipeline(pool, {});

    expect(outcome).toMatchObject({ ran: false, reason: 'error' });
    expect(unlocked()).toBe(true);
    expect(released()).toBe(true);
  });

  it('uses the fixed lock key by default', async () => {
    runPipeline.mockResolvedValueOnce({});
    const seen: string[] = [];
    const { pool } = fakePool({ locked: true, onQuery: (sql) => seen.push(sql) });

    await runScheduledPipeline(pool, {});

    expect(PIPELINE_ADVISORY_LOCK_KEY).toBeTypeOf('number');
    expect(seen.some((s) => s.includes('pg_try_advisory_lock'))).toBe(true);
  });
});
