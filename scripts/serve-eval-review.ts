import { join } from 'node:path';
import type pg from 'pg';
import { startEvalReviewServer } from '../eval/server/eval-review-server.js';
import { env } from '../src/config/env.js';
import { getDatabasePool } from '../src/db/pool.js';

const hostArg = process.argv.find((arg) => arg.startsWith('--host='));
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const datasetArg = process.argv.find((arg) => arg.startsWith('--dataset='));
const candidatesArg = process.argv.find((arg) => arg.startsWith('--candidates='));
const noDb = process.argv.includes('--no-db');

const host = hostArg ? hostArg.split('=')[1] : '127.0.0.1';
const port = portArg ? Number(portArg.split('=')[1]) : 4323;
const datasetPath = datasetArg ? datasetArg.split('=')[1] : join(process.cwd(), 'eval/datasets/cheap-filter-eval.jsonl');
const candidatesPath = candidatesArg
  ? candidatesArg.split('=')[1]
  : join(process.cwd(), 'eval/datasets/cheap-filter-candidates.jsonl');

let pool: pg.Pool | null = null;
if (!noDb && env.databaseUrl) {
  try {
    pool = getDatabasePool();
    await pool.query('SELECT 1');
  } catch (error) {
    console.warn(`Database unavailable (${(error as Error).message}); live decisions tab disabled.`);
    if (pool) await pool.end().catch(() => undefined);
    pool = null;
  }
}

try {
  await startEvalReviewServer({ host, port, datasetPath, candidatesPath, db: pool });
  console.log(`Eval review UI: http://${host}:${port}`);
  console.log(`Dataset: ${datasetPath}`);
  console.log(`Candidates: ${candidatesPath} (populate with: npm run eval:candidates)`);
  console.log(pool ? 'Live decisions tab: enabled (database connected).' : 'Live decisions tab: disabled (no database).');
  console.log('Press Ctrl+C to stop.');
} catch (error) {
  if (pool) await pool.end().catch(() => undefined);
  if (isAddressInUse(error)) {
    console.error(`Port ${host}:${port} is already in use. Try: npm run eval:review -- --port=4324`);
    process.exit(1);
  }
  throw error;
}

process.on('SIGINT', async () => {
  if (pool) await pool.end().catch(() => undefined);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (pool) await pool.end().catch(() => undefined);
  process.exit(0);
});

function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'EADDRINUSE'
  );
}
