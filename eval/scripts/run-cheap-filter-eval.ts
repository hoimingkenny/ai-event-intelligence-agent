import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { loadCheapFilterDataset } from '../utils/datasetLoader.js';
import { evaluateCheapFilterDataset, DEFAULT_CHEAP_FILTER_THRESHOLDS } from '../utils/metrics.js';
import { writeCheapFilterReports, type ReportFormat } from '../utils/reportWriters.js';
import type { CheapFilterEvaluationReport, CheapFilterEvaluationThresholds } from '../types/cheap-filter-eval.types.js';

export interface RunCheapFilterEvaluationOptions {
  datasetPath: string;
  outDir: string;
  formats: ReportFormat[];
  failOnThreshold: boolean;
  thresholds?: CheapFilterEvaluationThresholds;
}

export async function runCheapFilterEvaluation(options: RunCheapFilterEvaluationOptions): Promise<CheapFilterEvaluationReport> {
  const samples = await loadCheapFilterDataset(options.datasetPath);
  const report = evaluateCheapFilterDataset(samples, {
    datasetPath: options.datasetPath,
    thresholds: options.thresholds ?? DEFAULT_CHEAP_FILTER_THRESHOLDS,
  });
  await writeCheapFilterReports(report, options.outDir, options.formats);

  if (options.failOnThreshold && !report.gate.passed) {
    throw new Error(`Cheap-filter evaluation gate failed: ${report.gate.failures.join(' ')}`);
  }

  return report;
}

function parseArgs(args: string[]): RunCheapFilterEvaluationOptions {
  const datasetArg = readOption(args, '--dataset') ?? join(process.cwd(), 'eval/datasets/cheap-filter-eval.jsonl');
  const outArg = readOption(args, '--out') ?? join(process.cwd(), 'eval/reports');
  const formatArg = readOption(args, '--format') ?? 'markdown,json';
  const formats = formatArg.split(',').map((format) => format.trim()).filter(Boolean) as ReportFormat[];

  for (const format of formats) {
    if (format !== 'json' && format !== 'markdown') {
      throw new Error(`Unsupported cheap-filter report format: ${format}`);
    }
  }

  return {
    datasetPath: datasetArg,
    outDir: outArg,
    formats,
    failOnThreshold: args.includes('--fail-on-threshold'),
  };
}

function readOption(args: string[], name: string): string | null {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] ?? null;
  return null;
}

async function main(): Promise<void> {
  const report = await runCheapFilterEvaluation(parseArgs(process.argv.slice(2)));
  console.log(
    [
      'Cheap Filter Evaluation Report',
      `Dataset size: ${report.metrics.datasetSize}`,
      `Critical recall: ${formatPercent(report.metrics.criticalRecall)}`,
      `Relevant recall: ${formatPercent(report.metrics.relevantRecall)}`,
      `False negative rate: ${formatPercent(report.metrics.falseNegativeRate)}`,
      `Critical miss rate: ${formatPercent(report.metrics.criticalMissRate)}`,
      `Pass-through rate: ${formatPercent(report.metrics.passThroughRate)}`,
      `Reason-code coverage: ${formatPercent(report.metrics.reasonCodeCoverage)}`,
      `Gate: ${report.gate.passed ? 'passed' : 'failed'}`,
    ].join('\n')
  );
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
