import { join } from 'node:path';
import { getDatabasePool } from '../src/db/pool.js';
import { runEvaluation } from '../src/evaluation/run-evaluation.js';

const datasetArg = process.argv.find((arg) => arg.startsWith('--dataset='));
const runNameArg = process.argv.find((arg) => arg.startsWith('--run-name='));
const shouldPersist = process.argv.includes('--persist');
const datasetPath = datasetArg ? datasetArg.split('=')[1] : join(process.cwd(), 'data/labelled-eval-set.json');
const runName = runNameArg ? runNameArg.split('=')[1] : undefined;

async function main(): Promise<void> {
  const pool = shouldPersist ? getDatabasePool() : null;

  try {
    const result = await runEvaluation(pool, {
      datasetPath,
      runName,
      persist: shouldPersist,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool?.end();
  }
}

await main();
