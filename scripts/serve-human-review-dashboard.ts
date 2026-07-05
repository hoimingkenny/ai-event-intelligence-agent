import { getDatabasePool } from '../src/db/pool.js';
import { startHumanReviewServer } from '../src/review/human-review-server.js';

const hostArg = process.argv.find((arg) => arg.startsWith('--host='));
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));

const host = hostArg ? hostArg.split('=')[1] : '127.0.0.1';
const port = portArg ? Number(portArg.split('=')[1]) : 4321;
const defaultLimit = limitArg ? Number(limitArg.split('=')[1]) : 50;

const pool = getDatabasePool();
try {
  await startHumanReviewServer(pool, { host, port, defaultLimit });
  console.log(`Human review dashboard: http://${host}:${port}`);
  console.log('Press Ctrl+C to stop.');
} catch (error) {
  await pool.end();
  if (isAddressInUse(error)) {
    console.error(`Port ${host}:${port} is already in use.`);
    console.error(`If the dashboard is already running, open http://${host}:${port}`);
    console.error(`Otherwise stop the existing process or run: npm run review:dashboard -- --port=4322`);
    process.exit(1);
  }
  throw error;
}

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await pool.end();
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
