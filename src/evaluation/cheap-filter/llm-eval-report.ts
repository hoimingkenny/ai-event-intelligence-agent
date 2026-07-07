import type { LlmEvaluationRow, LlmEvalSummary } from './llm-eval-types.js';

export interface RenderReportInput {
  summary: LlmEvalSummary;
  sampleArticleIds: string[];
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function metricRow(label: string, value: string, target: string, status: 'pass' | 'fail' | 'info'): string {
  return `| ${label} | ${value} | ${target} | ${status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : 'Info'} |`;
}

function topRows<T>(rows: T[], columns: string[], renderRow: (row: T) => string): string[] {
  if (rows.length === 0) return ['None.'];
  return [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map(renderRow),
  ];
}

function renderArticleDetail(rows: LlmEvaluationRow[], header: string): string {
  if (rows.length === 0) return `## ${header}\n\nNone.`;
  const lines: string[] = [`## ${header}`, ''];
  for (const row of rows.slice(0, 10)) {
    lines.push(`### Article ${row.articleId}`);
    lines.push('');
    lines.push(`- Cheap decision: \`${row.cheapFilterDecision}\` (score ${row.cheapFilterScore})`);
    lines.push(`- LLM label: \`${row.llmLabel}\` (expected decision: \`${row.expectedDecision}\`)`);
    lines.push(`- Score assessment: \`${row.scoreAssessment}\` (recommended band: \`${row.recommendedScoreBand ?? '—'}\`)`);
    lines.push(`- Relevance type: \`${row.relevanceType}\``);
    lines.push(`- Scoring issue: \`${row.scoringIssue}\``);
    lines.push(`- Explanation: ${row.explanation}`);
    if (row.suggestedKeywordsToAdd.length > 0) {
      lines.push(`- Suggested keywords: ${row.suggestedKeywordsToAdd.map((s) => `\`${s}\``).join(', ')}`);
    }
    if (row.suggestedVendorProductAliasesToAdd.length > 0) {
      lines.push(`- Suggested aliases: ${row.suggestedVendorProductAliasesToAdd.map((s) => `\`${s}\``).join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function generateCheapFilterLlmEvalReport(input: RenderReportInput): string {
  const { summary, sampleArticleIds } = input;
  const m = summary.metrics;
  const targets: Array<{ label: string; value: number; target: string; pass: boolean }> = [
    { label: 'Critical recall proxy', value: m.criticalRecallProxy, target: '100%', pass: m.criticalRecallProxy >= 0.999 },
    { label: 'Relevant recall proxy', value: m.relevantRecallProxy, target: '>=95%', pass: m.relevantRecallProxy >= 0.95 },
    { label: 'Irrelevant drop rate', value: m.irrelevantDropRate, target: '>=80%', pass: m.irrelevantDropRate >= 0.80 },
    { label: 'Borderline retention', value: m.borderlineRetentionRate, target: '>=90%', pass: m.borderlineRetentionRate >= 0.90 },
    { label: 'Critical under-scored rate', value: m.criticalUnderScoredRate, target: '0%', pass: m.criticalUnderScoredRate === 0 },
    { label: 'Irrelevant over-scored rate', value: m.irrelevantOverScoredRate, target: '<=20%', pass: m.irrelevantOverScoredRate <= 0.20 },
  ];

  const scoreAssessmentRows = (Object.entries(m.scoreAssessmentDistribution) as [string, number][])
    .map(([k, v]) => `| ${k} | ${v} |`);

  const labelRows = (Object.entries(summary.labelDistribution) as [string, number][])
    .map(([k, v]) => `| ${k} | ${v} |`);

  const decisionRows = (Object.entries(summary.cheapDecisionDistribution) as [string, number][])
    .map(([k, v]) => `| ${k} | ${v} |`);

  const disagreementRows = (Object.entries(summary.disagreementDistribution) as [string, number][])
    .map(([k, v]) => `| ${k} | ${v} |`);

  const scoringIssueRows = (Object.entries(summary.scoringIssueDistribution) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v} |`);

  const relevanceTypeRows = (Object.entries(summary.relevanceTypeDistribution) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v} |`);

  return [
    '# Cheap Filter LLM Evaluation Report',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    '## 1. Run Metadata',
    '',
    `- Run ID: \`${summary.runId}\``,
    `- Model: \`${summary.modelName}\``,
    `- Prompt version: \`${summary.promptVersion}\``,
    `- Articles sampled: ${summary.totalSampled}`,
    `- Articles evaluated: ${summary.totalEvaluated}`,
    `- Articles failed: ${summary.totalFailed}`,
    `- Sample article IDs:`,
    ...sampleArticleIds.slice(0, 50).map((id) => `  - \`${id}\``),
    sampleArticleIds.length > 50 ? `  - …(${sampleArticleIds.length - 50} more)` : '',
    '',
    '## 2. Summary',
    '',
    '| Metric | Value | Target | Status |',
    '| --- | ---: | --- | --- |',
    ...targets.map((t) => metricRow(t.label, pct(t.value), t.target, t.pass ? 'pass' : 'fail')),
    '',
    '## 3. Score Assessment Distribution',
    '',
    '| Assessment | Count |',
    '| --- | ---: |',
    ...scoreAssessmentRows,
    '',
    '## 4. LLM Label Distribution',
    '',
    '| Label | Count |',
    '| --- | ---: |',
    ...labelRows,
    '',
    '## 5. Cheap Filter Decision Distribution',
    '',
    '| Decision | Count |',
    '| --- | ---: |',
    ...decisionRows,
    '',
    '## 6. Disagreement Distribution',
    '',
    '| Type | Count |',
    '| --- | ---: |',
    ...disagreementRows,
    '',
    '## 7. Top Scoring Issues',
    '',
    ...(scoringIssueRows.length === 0
      ? ['None.']
      : ['| Issue | Count |', '| --- | ---: |', ...scoringIssueRows]),
    '',
    '## 8. Relevance Type Distribution',
    '',
    ...(relevanceTypeRows.length === 0
      ? ['None.']
      : ['| Type | Count |', '| --- | ---: |', ...relevanceTypeRows]),
    '',
    '## 9. Suggested Keywords',
    '',
    ...(summary.suggestedKeywords.length === 0
      ? ['None.']
      : topRows(
          summary.suggestedKeywords,
          ['Keyword', 'Count'],
          (r) => `| ${r.key} | ${r.count} |`
        )),
    '',
    '## 10. Suggested Vendor / Product Aliases',
    '',
    ...(summary.suggestedAliases.length === 0
      ? ['None.']
      : topRows(
          summary.suggestedAliases,
          ['Alias', 'Count'],
          (r) => `| ${r.key} | ${r.count} |`
        )),
    '',
    '## 11. False Positives by Vendor',
    '',
    ...(summary.vendorFalsePositiveCounts.length === 0
      ? ['None.']
      : topRows(
          summary.vendorFalsePositiveCounts,
          ['Vendor', 'Count'],
          (r) => `| ${r.vendor} | ${r.count} |`
        )),
    '',
    '## 12. Over-Scored by Source Tier (IRRELEVANT + score>=40)',
    '',
    ...(summary.sourceTierOverScoredCounts.length === 0
      ? ['None.']
      : topRows(
          summary.sourceTierOverScoredCounts,
          ['Source tier', 'Count'],
          (r) => `| ${r.sourceTier} | ${r.count} |`
        )),
    '',
    renderArticleDetail(summary.falseNegativeRisks, '13. False-Negative Risks (CRITICAL_RELEVANT but not KEEP)'),
    '',
    renderArticleDetail(summary.falsePositiveRisks, '14. False-Positive Risks (IRRELEVANT but KEEP)'),
    '',
    '## 15. Sample Disagreements (first 25 non-reasonable)',
    '',
    ...(summary.sampleDisagreements.length === 0
      ? ['None — every evaluation was reasonable. Investigate that the LLM is actually pushing back when warranted.']
      : topRows(
          summary.sampleDisagreements,
          ['articleId', 'cheap', 'score', 'llmLabel', 'expected', 'issue'],
          (r) => `| \`${r.articleId.slice(0, 8)}\` | ${r.cheapFilterDecision} | ${r.cheapFilterScore} | ${r.llmLabel} | ${r.expectedDecision} | ${r.scoringIssue} |`
        )),
    '',
    '## 16. Recommended Workflow',
    '',
    '1. Review disagreement clusters by `scoringIssue` and `relevanceType`.',
    '2. Accept / reject suggested keyword and alias additions against the [Cyber Keyword Classification Standard](../design/cyber-keyword-classification-standard.md) and the [Implemented Rule Engine](../design/cheap-filter-rule-engine.md).',
    '3. Update the deterministic code or the vendor inventory.',
    '4. Re-run `npm run eval:cheap-filter` against the labelled dataset.',
    '5. Re-run `npm run eval:cheap-filter:judge` on the same sample and diff the metrics.',
    '',
    'Do not change rules based on one article. Use the threshold triggers in §17 of the plan (e.g. >=3 examples per suggested keyword, >=10 examples for `vendor_score_too_high`).',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}