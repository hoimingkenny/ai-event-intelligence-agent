import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDatabasePool } from '../../src/db/pool.js';
import { runDigestEval } from '../../src/evaluation/digest/digest-eval-runner.js';
import type { DigestReportFormat } from '../utils/digest-report-writers.js';

export interface RunDigestEvalCliOptions {
  mode: 'baseline' | 'regen';
  outDir: string;
  formats: DigestReportFormat[];
  dryRun: boolean;
  concurrency: number;
}

function readOption(args: string[], name: string): string | undefined {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function parseArgs(args: string[]): RunDigestEvalCliOptions {
  const formatArg = readOption(args, '--format') ?? 'markdown,json';
  const formats = formatArg
    .split(',')
    .map((format) => format.trim())
    .filter(Boolean) as DigestReportFormat[];

  for (const format of formats) {
    if (format !== 'json' && format !== 'markdown') {
      throw new Error(`Unsupported digest eval report format: ${format}`);
    }
  }

  const concurrency = Number(readOption(args, '--concurrency') ?? '2');
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error('--concurrency must be a positive number');
  }

  return {
    mode: args.includes('--regen') ? 'regen' : 'baseline',
    outDir: readOption(args, '--out') ?? join(process.cwd(), 'eval/reports'),
    formats,
    dryRun: args.includes('--dry-run'),
    concurrency,
  };
}

export async function runDigestEvalCli(options: RunDigestEvalCliOptions): Promise<void> {
  await mkdir(options.outDir, { recursive: true });
  const { report, runId } = await runDigestEval(getDatabasePool(), {
    mode: options.mode,
    outDir: options.outDir,
    formats: options.formats,
    concurrency: options.concurrency,
    dryRun: options.dryRun,
  });

  console.log(
    [
      'Digest Eval Report',
      `Mode: ${report.mode}`,
      `Run id: ${runId}`,
      `Gold count: ${report.metrics.goldCount}`,
      `Relatedness F1: ${formatRate(report.metrics.relatednessF1)}`,
      `Vendor exact: ${formatNullableRate(report.metrics.vendorExactMatchRate)}`,
      `Product exact: ${formatNullableRate(report.metrics.productExactMatchRate)}`,
      `CVE exact: ${formatRate(report.metrics.cveExactMatchRate)}`,
      `Soft gates: ${report.gate.active ? 'active' : 'inactive'}`,
      ...(report.gate.warnings.length > 0 ? report.gate.warnings.map((w) => `  - ${w}`) : []),
      ...(report.comparisonDelta
        ? [
            `Baseline comparison (run ${report.comparisonBaselineRunId}):`,
            `  Relatedness F1 Δ: ${formatSigned(report.comparisonDelta.relatednessF1)}`,
          ]
        : []),
    ].join('\n')
  );
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNullableRate(value: number | null): string {
  return value === null ? 'n/a' : formatRate(value);
}

function formatSigned(value: number): string {
  const pct = (value * 100).toFixed(1);
  return value >= 0 ? `+${pct}%` : `${pct}%`;
}

async function main(): Promise<void> {
  await runDigestEvalCli(parseArgs(process.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
