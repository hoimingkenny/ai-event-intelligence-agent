import { getDatabasePool } from '../src/db/pool.js';
import { checkAlertLatency } from '../src/monitoring/alert-latency.js';

async function main(): Promise<void> {
  const pool = getDatabasePool();

  try {
    const report = await checkAlertLatency(pool);
    console.log(JSON.stringify(report, null, 2));
    if (report.sloViolated) {
      console.error(`ALERT LATENCY SLO VIOLATED: p90 ${report.p90Hours?.toFixed(2)}h > ${report.sloHours}h`);
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

await main();
