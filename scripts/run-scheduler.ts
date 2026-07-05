/**
 * Internal scheduler entrypoint (long-running). Runs the full pipeline every
 * RSS_FETCH_INTERVAL_MINUTES (default 20). Use this in environments without an
 * external cron; for cron/Kubernetes CronJob, use `npm run pipeline:run` as a
 * one-shot instead — both share the advisory-locked core.
 *
 *   npm run scheduler
 *   RSS_FETCH_INTERVAL_MINUTES=10 npm run scheduler
 */
import { env } from '../src/config/env.js';
import { getDatabasePool, closeDatabasePool } from '../src/db/pool.js';
import { startPipelineScheduler } from '../src/pipeline/scheduler.js';
import { logInfo } from '../src/utils/logger.js';

const pool = getDatabasePool();
const intervalMs = Math.max(1, env.rssFetchIntervalMinutes) * 60_000;

const scheduler = startPipelineScheduler(pool, {
  intervalMs,
  includeIngest: true,
  includeLlm: Boolean(env.minimaxApiKey),
});

async function shutdown(signal: string): Promise<void> {
  logInfo({ signal }, 'scheduler_shutdown_requested');
  await scheduler.stop();
  await closeDatabasePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
