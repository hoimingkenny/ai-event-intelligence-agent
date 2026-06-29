import { getDatabasePool } from '../src/db/pool.js';
import { runPipeline } from '../src/pipeline/runner.js';

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
const includeIngest = !process.argv.includes('--skip-ingest');
const includeLlm = process.argv.includes('--include-llm');

async function main(): Promise<void> {
  const pool = getDatabasePool();

  try {
    const result = await runPipeline(pool, {
      limit: Number.isFinite(limit) ? limit : undefined,
      includeIngest,
      includeLlm,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

await main();
