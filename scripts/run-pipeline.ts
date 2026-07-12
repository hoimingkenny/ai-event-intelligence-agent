/**
 * One-shot pipeline run. Suitable for an external scheduler (system cron,
 * Kubernetes CronJob, cloud scheduler) firing every 20 minutes — the run is
 * advisory-locked, so a tick that fires while a previous run is still going is
 * skipped (exit 0) rather than stacked. For a self-contained loop instead, use
 * `npm run scheduler`.
 */
import { getDatabasePool } from '../src/db/pool.js';
import { runScheduledPipeline } from '../src/pipeline/scheduled-run.js';

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
const includeIngest = !process.argv.includes('--skip-ingest');
const includeLlm = process.argv.includes('--include-llm');

async function main(): Promise<number> {
  const pool = getDatabasePool();

  try {
    const outcome = await runScheduledPipeline(pool, {
      limit: Number.isFinite(limit) ? limit : undefined,
      includeIngest,
      includeLlm,
    });
    console.log(JSON.stringify(outcome, null, 2));
    return !outcome.ran && outcome.reason === 'error' ? 1 : 0;
  } finally {
    await pool.end();
  }
}

const code = await main().catch((error) => {
  console.error(error);
  return 1;
});
// LLM / embedding HTTP clients keep sockets open; force exit for one-shot CLI.
process.exit(code);
