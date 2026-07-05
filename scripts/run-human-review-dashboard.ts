import { getDatabasePool } from '../src/db/pool.js';
import { writeHumanReviewDashboard } from '../src/review/human-review-dashboard.js';

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 50;
const outputDir = outputArg ? outputArg.split('=')[1] : undefined;

async function main(): Promise<void> {
  const pool = getDatabasePool();

  try {
    const { dashboard, outputPath } = await writeHumanReviewDashboard(pool, {
      limit,
      outputDir,
    });

    console.log(`Human review dashboard: ${outputPath}`);
    console.log(
      `Articles=${dashboard.summary.totalArticles} needs_review=${dashboard.summary.needsAttention} early_warnings=${dashboard.summary.earlyWarnings} confirmed=${dashboard.summary.confirmedAlerts}`
    );
  } finally {
    await pool.end();
  }
}

await main();
