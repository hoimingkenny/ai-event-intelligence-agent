import type pg from 'pg';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import { buildMaintenanceAdapterSet, type MaintenanceAdapterSet } from './cases.js';
import { runMaintenanceTick, type MaintenanceTickResult } from './maintenance.js';

/**
 * Singleton-safe CVE enrichment maintenance runner (ticket #60).
 *
 * Mirrors `runScheduledPipeline`: a Postgres session-level advisory lock guarantees only
 * one tick can run at a time across replicas. A skipped tick loses nothing because the
 * tick itself is idempotent — the cursor advances only on a successful tick and unchanged
 * CVEs do not get duplicate observation rows.
 *
 * `pg_try_advisory_lock` returns immediately (never blocks); the lock is tied to the
 * connection, so it releases even if the process crashes mid-run.
 */

/** Arbitrary but fixed key identifying the "cve maintenance" lock (distinct from the pipeline key). */
export const CVE_MAINTENANCE_ADVISORY_LOCK_KEY = 7_311_202;

export type ScheduledMaintenanceOutcome =
  | { ran: true; result: MaintenanceTickResult; durationMs: number }
  | { ran: false; reason: 'locked' | 'error'; durationMs: number; error?: unknown };

export async function runScheduledMaintenance(
  pool: pg.Pool,
  options: {
    lockKey?: number;
    adapters?: Partial<MaintenanceAdapterSet>;
    now?: () => Date;
    nvdSafetyBufferMs?: number;
  } = {}
): Promise<ScheduledMaintenanceOutcome> {
  const lockKey = options.lockKey ?? CVE_MAINTENANCE_ADVISORY_LOCK_KEY;
  const startedAt = Date.now();
  const client = await pool.connect();
  try {
    const locked = await tryAdvisoryLock(client, lockKey);
    if (!locked) {
      logWarn({ lockKey }, 'scheduled_cve_maintenance_skipped_locked');
      return { ran: false, reason: 'locked', durationMs: Date.now() - startedAt };
    }

    try {
      logInfo({ lockKey }, 'scheduled_cve_maintenance_started');
      const adapters = buildMaintenanceAdapterSet({ adapters: options.adapters });
      const result = await runMaintenanceTick(pool, adapters, {
        now: options.now,
        nvdSafetyBufferMs: options.nvdSafetyBufferMs,
      });
      const durationMs = Date.now() - startedAt;
      logInfo({ durationMs, sources: result.sources.map((s) => s.source) }, 'scheduled_cve_maintenance_completed');
      return { ran: true, result, durationMs };
    } finally {
      await advisoryUnlock(client, lockKey);
    }
  } catch (error) {
    logError(
      { error: error instanceof Error ? error.message : String(error) },
      'scheduled_cve_maintenance_failed'
    );
    return { ran: false, reason: 'error', durationMs: Date.now() - startedAt, error };
  } finally {
    client.release();
  }
}

async function tryAdvisoryLock(client: pg.PoolClient, lockKey: number): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [lockKey]);
  return result.rows[0]?.locked === true;
}

async function advisoryUnlock(client: pg.PoolClient, lockKey: number): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
  } catch {
    // Best effort: connection death releases the lock anyway.
  }
}