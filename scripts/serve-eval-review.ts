import { join } from 'node:path';
import { startEvalReviewServer } from '../eval/server/eval-review-server.js';

const hostArg = process.argv.find((arg) => arg.startsWith('--host='));
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const datasetArg = process.argv.find((arg) => arg.startsWith('--dataset='));
const candidatesArg = process.argv.find((arg) => arg.startsWith('--candidates='));

const host = hostArg ? hostArg.split('=')[1] : '127.0.0.1';
const port = portArg ? Number(portArg.split('=')[1]) : 4323;
const datasetPath = datasetArg ? datasetArg.split('=')[1] : join(process.cwd(), 'eval/datasets/cheap-filter-eval.jsonl');
const candidatesPath = candidatesArg
  ? candidatesArg.split('=')[1]
  : join(process.cwd(), 'eval/datasets/cheap-filter-candidates.jsonl');

try {
  await startEvalReviewServer({ host, port, datasetPath, candidatesPath });
  console.log(`Eval review UI: http://${host}:${port}`);
  console.log(`Dataset: ${datasetPath}`);
  console.log(`Candidates: ${candidatesPath} (populate with: npm run eval:candidates)`);
  console.log('Press Ctrl+C to stop.');
} catch (error) {
  if (isAddressInUse(error)) {
    console.error(`Port ${host}:${port} is already in use. Try: npm run eval:review -- --port=4324`);
    process.exit(1);
  }
  throw error;
}

function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'EADDRINUSE'
  );
}
