/**
 * Article monitoring portal (read-only). Lists every article with its status,
 * scores, and extraction quality; click a row to inspect entities, events,
 * alerts, and preview the extracted article text.
 *
 *   npm run portal
 *   PORT=5000 npm run portal
 */
import { getDatabasePool, closeDatabasePool } from '../src/db/pool.js';
import { startArticlesPortal } from '../src/portal/articles-portal-server.js';
import { logInfo } from '../src/utils/logger.js';

const pool = getDatabasePool();
const port = Number(process.env.PORT ?? 4322);
const host = process.env.PORTAL_HOST ?? '127.0.0.1';

const server = await startArticlesPortal(pool, { port, host });
logInfo({ url: `http://${host}:${port}` }, 'articles_portal_listening');
console.log(`Article portal: http://${host}:${port}`);

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabasePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
