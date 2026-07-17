import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestEvalReport } from '../types/digest-eval.types.js';

export type DigestReportFormat = 'json' | 'markdown';

export async function writeDigestEvalReports(
  report: DigestEvalReport,
  outDir: string,
  formats: DigestReportFormat[],
  options: { filenamePrefix?: string } = {}
): Promise<{ jsonPath: string | null; markdownPath: string | null }> {
  await mkdir(outDir, { recursive: true });
  const prefix = options.filenamePrefix ?? `digest-eval-${report.mode}`;
  let jsonPath: string | null = null;
  let markdownPath: string | null = null;

  if (formats.includes('json')) {
    jsonPath = join(outDir, `${prefix}.json`);
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (formats.includes('markdown')) {
    markdownPath = join(outDir, `${prefix}.md`);
    await writeFile(markdownPath, renderDigestEvalMarkdown(report));
  }

  return { jsonPath, markdownPath };
}

export function renderDigestEvalMarkdown(report: DigestEvalReport): string {
  const lines = [
    '# Digest Eval Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Prompt version: ${report.promptVersion}`,
    report.modelName ? `Model: ${report.modelName}` : null,
    report.runId ? `Run id: ${report.runId}` : null,
    `Gold count: ${report.metrics.goldCount}`,
    '',
    '## Metrics',
    '',
    `- Relatedness F1: ${formatRate(report.metrics.relatednessF1)}`,
    `- Relatedness precision: ${formatRate(report.metrics.relatednessPrecision)}`,
    `- Relatedness recall: ${formatRate(report.metrics.relatednessRecall)}`,
    `- Vendor exact-match: ${formatNullableRate(report.metrics.vendorExactMatchRate)} (${report.metrics.relatedGoldCount} related gold)`,
    `- Product exact-match: ${formatNullableRate(report.metrics.productExactMatchRate)}`,
    `- CVE exact-match: ${formatRate(report.metrics.cveExactMatchRate)}`,
    `- Vendor set-F1: ${formatNullableRate(report.metrics.vendorSetF1)}`,
    `- Product set-F1: ${formatNullableRate(report.metrics.productSetF1)}`,
    `- CVE set-F1: ${formatRate(report.metrics.cveSetF1)}`,
    '',
    '## Soft gates',
    '',
    report.gate.active ? 'Active.' : 'Inactive.',
    '',
    ...(report.gate.warnings.length > 0
      ? report.gate.warnings.map((warning) => `- ${warning}`)
      : ['- No warnings.']),
    '',
  ];

  if (report.comparisonDelta) {
    lines.push(
      '## Comparison vs baseline',
      '',
      `Baseline run: ${report.comparisonBaselineRunId ?? '—'}`,
      `- Relatedness F1 Δ: ${formatSignedDelta(report.comparisonDelta.relatednessF1)}`,
      `- Vendor exact Δ: ${formatSignedNullableDelta(report.comparisonDelta.vendorExactMatchRate)}`,
      `- Product exact Δ: ${formatSignedNullableDelta(report.comparisonDelta.productExactMatchRate)}`,
      `- CVE exact Δ: ${formatSignedDelta(report.comparisonDelta.cveExactMatchRate)}`,
      ''
    );
  }

  const failures = report.results.filter((result) => result.failures.length > 0);
  lines.push('## Sample failures', '', failureTable(failures), '');

  return lines.filter((line) => line !== null).join('\n');
}

function failureTable(
  results: DigestEvalReport['results']
): string {
  if (results.length === 0) return '_No failures._';
  return [
    '| Article | Failures |',
    '| --- | --- |',
    ...results.map(
      (result) => `| ${result.articleId} | ${result.failures.join('; ')} |`
    ),
  ].join('\n');
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNullableRate(value: number | null): string {
  return value === null ? 'n/a' : formatRate(value);
}

function formatSignedDelta(value: number): string {
  const pct = (value * 100).toFixed(1);
  return value >= 0 ? `+${pct}%` : `${pct}%`;
}

function formatSignedNullableDelta(value: number | null): string {
  return value === null ? 'n/a' : formatSignedDelta(value);
}
