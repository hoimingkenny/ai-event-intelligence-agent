import { getDatabasePool } from '../src/db/pool.js';
import { checkExtractionDrift } from '../src/monitoring/extraction-drift.js';

async function main(): Promise<void> {
  const pool = getDatabasePool();

  try {
    const result = await checkExtractionDrift(pool);
    console.log(JSON.stringify(result, null, 2));
    if (result.driftedSources.length > 0) {
      console.error(`DRIFT DETECTED: ${result.driftedSources.join(', ')}`);
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

await main();
