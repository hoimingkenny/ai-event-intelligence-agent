import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { loadCheapFilterDataset } from '../utils/datasetLoader.js';
import { HUMAN_LABELS, type HumanLabel } from '../types/cheap-filter-eval.types.js';

async function main(): Promise<void> {
  const pathArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  const datasetPath = pathArg ?? join(process.cwd(), 'eval/datasets/cheap-filter-eval.jsonl');

  const samples = await loadCheapFilterDataset(datasetPath);
  const counts = Object.fromEntries(HUMAN_LABELS.map((label) => [label, 0])) as Record<HumanLabel, number>;
  for (const sample of samples) counts[sample.humanLabel] += 1;

  console.log(`OK: ${samples.length} valid sample(s) in ${datasetPath}`);
  for (const label of HUMAN_LABELS) console.log(`  ${label}: ${counts[label]}`);
  if (samples.length < 50) {
    console.log(`Note: dataset has fewer than 50 samples; recall/miss metrics are coarse (each sample moves them by ${(100 / Math.max(samples.length, 1)).toFixed(1)}pp or more).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Dataset validation failed: ${(error as Error).message}`);
    process.exit(1);
  }
}
