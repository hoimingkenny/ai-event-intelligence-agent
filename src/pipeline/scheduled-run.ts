import type pg from 'pg';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import { runPipeline, type PipelineRunOptions, type PipelineRunResult } from './runner.js';

/**
 * Singleton-safe pipeline execution.
 *
 * A scheduled pipeline must never run concurrently with itself: if one tick
 * overruns its interval (backlog, slow LLM), the next tick must be *skipped*,
 * not stacked on top of the same data. A Postgres session-level advisory lock
 * enforces this with zero new infrastructure and makes running multiple app
 * replicas safe — only the lock holder runs, the rest skip.
 *
 * `pg_try_advisory_lock` returns immediately (never blocks); the lock is tied
 * to the connection, so it releases even if the process crashes mid-run. The
 * pipeline itself is idempotent (Postgres processing_status is the system of
 * record), so a skipped or resumed tick loses nothing.
 */

/** Arbitrary but fixed key identifying the "pipeline run" lock. */
export const PIPELINE_ADVISORY_LOCK_KEY = 4_820_017;

export type ScheduledRunOutcome =
  | { ran: true; result: PipelineRunResult; durationMs: number }
  | { ran: false; reason: 'locked' | 'error'; durationMs: number; error?: unknown };

export async function runScheduledPipeline(
  pool: pg.Pool,
  options: PipelineRunOptions & { lockKey?: number } = {}
): Promise<ScheduledRunOutcome> {
  const lockKey = options.lockKey ?? PIPELINE_ADVISORY_LOCK_KEY;
  const startedAt = Date.now();

  // A dedicated connection owns the lock for the whole run.
  const client = await pool.connect();
  try {
    const locked = await tryAdvisoryLock(client, lockKey);
    if (!locked) {
      logWarn({ lockKey }, 'scheduled_pipeline_skipped_locked');
      return { ran: false, reason: 'locked', durationMs: Date.now() - startedAt };
    }

    try {
      logInfo({ lockKey }, 'scheduled_pipeline_started');
      const result = await runPipeline(pool, options);
      const durationMs = Date.now() - startedAt;
      logInfo({ durationMs }, 'scheduled_pipeline_completed');
      return { ran: true, result, durationMs };
    } finally {
      await advisoryUnlock(client, lockKey);
    }
  } catch (error) {
    logError(
      { error: error instanceof Error ? error.message : String(error) },
      'scheduled_pipeline_failed'
    );
    return { ran: false, reason: 'error', durationMs: Date.now() - startedAt, error };
  } finally {
    client.release();
  }
}

async function tryAdvisoryLock(client: pg.PoolClient, key: number): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [key]
  );
  return result.rows[0]?.locked === true;
}

async function advisoryUnlock(client: pg.PoolClient, key: number): Promise<void> {
  await client.query('SELECT pg_advisory_unlock($1)', [key]);
}
