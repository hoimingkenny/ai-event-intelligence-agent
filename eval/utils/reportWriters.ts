import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CHEAP_FILTER_DECISIONS,
  HUMAN_LABELS,
  type CheapFilterEvaluationReport,
  type CheapFilterEvaluationResult,
} from '../types/cheap-filter-eval.types.js';

export type ReportFormat = 'json' | 'markdown';

export async function writeCheapFilterReports(
  report: CheapFilterEvaluationReport,
  outDir: string,
  formats: ReportFormat[]
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  if (formats.includes('json')) {
    await writeFile(join(outDir, 'cheap-filter-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (formats.includes('markdown')) {
    await writeFile(join(outDir, 'cheap-filter-report.md'), renderMarkdownReport(report));
  }
}

export function renderMarkdownReport(report: CheapFilterEvaluationReport): string {
  return `# Cheap Filter Evaluation Report

Generated: ${report.generatedAt}

Dataset: \`${report.datasetPath}\`

Dataset size: ${report.metrics.datasetSize}

## Summary Metrics

- Critical recall: ${formatPercent(report.metrics.criticalRecall)}
- Relevant recall: ${formatPercent(report.metrics.relevantRecall)}
- False negative rate: ${formatPercent(report.metrics.falseNegativeRate)}
- Critical miss rate: ${formatPercent(report.metrics.criticalMissRate)}
- Pass-through rate: ${formatPercent(report.metrics.passThroughRate)}
- KEEP rate: ${formatPercent(report.metrics.keepRate)}
- MAYBE_KEEP rate: ${formatPercent(report.metrics.maybeKeepRate)}
- Irrelevant pass rate: ${formatPercent(report.metrics.irrelevantPassRate)}
- Reason-code coverage: ${formatPercent(report.metrics.reasonCodeCoverage)}

## Gate

${report.gate.passed ? 'Passed.' : 'Failed.'}

${listOrNone(report.gate.failures)}
${report.gate.warnings.length > 0 ? `\nWarnings:\n\n${report.gate.warnings.map((warning) => `- ${warning}`).join('\n')}\n` : ''}

## Confusion Matrix

| Human label | KEEP | MAYBE_KEEP | DROP |
| --- | ---: | ---: | ---: |
${HUMAN_LABELS.map((label) => `| ${label} | ${CHEAP_FILTER_DECISIONS.map((decision) => report.confusionMatrix[label][decision]).join(' | ')} |`).join('\n')}

## False Negatives

${failureTable(report.falseNegatives)}

## Critical Priority Failures

${failureTable(report.criticalPriorityFailures)}

## Top Failure Buckets

${topCounts(report.failuresByBucket)}

## Recommended Actions

${report.recommendedActions.map((action, index) => `${index + 1}. ${action}`).join('\n')}

## Shadow Evaluation Follow-up

Future production control: sample a small percentage of DROP decisions for extraction or manual review, with higher sampling for high-trust sources, monitored vendor mentions, and security RSS categories.
`;
}

const SEVERITY_ORDER: Record<string, number> = { severe: 0, high: 1, medium: 2, low: 3 };

function failureTable(results: CheapFilterEvaluationResult[]): string {
  if (results.length === 0) return 'None.';
  const sorted = [...results].sort(
    (a, b) => (SEVERITY_ORDER[a.severity ?? ''] ?? 9) - (SEVERITY_ORDER[b.severity ?? ''] ?? 9)
  );
  const rows = sorted.map((result) =>
    `| ${result.id} | ${result.severity ?? 'n/a'} | ${result.humanLabel} | ${result.decision} | ${result.score} | ${result.failureBucket} | ${result.suggestedFix} | ${escapeCell(matchedSignalSummary(result))} | ${escapeCell(result.title)} |`
  );
  return [
    '| ID | Severity | Label | Decision | Score | Bucket | Suggested fix | Matched signals | Title |',
    '| --- | --- | --- | --- | ---: | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function matchedSignalSummary(result: CheapFilterEvaluationResult): string {
  const signals = result.matchedSignals;
  const parts = [
    ...signals.cves,
    ...signals.vendors,
    ...signals.products,
    ...signals.criticalCyberKeywords,
    ...signals.mediumCyberKeywords,
    ...signals.negativeKeywords.map((keyword) => `-${keyword}`),
  ];
  return parts.length > 0 ? parts.join(', ') : 'none';
}

function topCounts(counts: Partial<Record<string, number>>): string {
  const rows = Object.entries(counts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (rows.length === 0) return 'None.';
  return rows.map(([name, count], index) => `${index + 1}. ${name}: ${count}`).join('\n');
}

function listOrNone(items: string[]): string {
  return items.length === 0 ? 'No gate failures.' : items.map((item) => `- ${item}`).join('\n');
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}
