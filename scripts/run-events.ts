import { getDatabasePool } from '../src/db/pool.js';
import { runEventStage } from '../src/pipeline/event-stage.js';

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

async function main(): Promise<void> {
  const pool = getDatabasePool();

  try {
    const result = await runEventStage(pool, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

await main();
