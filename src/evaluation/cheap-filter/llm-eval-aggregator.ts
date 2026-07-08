import {
  DISAGREEMENT_VALUES,
  LLM_EVAL_LABEL_VALUES,
  RELEVANCE_TYPE_VALUES,
  SCORE_ASSESSMENT_VALUES,
  SCORING_ISSUE_VALUES,
  type CheapFilterEvalInput,
  type DisagreementType,
  type LlmEvaluationLabel,
  type LlmEvaluationRow,
  type LlmEvalSummary,
  type LlmEvalSummaryMetrics,
  type RelevanceType,
  type ScoreAssessment,
  type ScoringIssue,
} from './llm-eval-types.js';

export interface AggregatorInput {
  runId: string;
  modelName: string;
  promptVersion: string;
  totalSampled: number;
  totalFailed: number;
  inputs: CheapFilterEvalInput[];
  evaluations: LlmEvaluationRow[];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function emptyDistribution<K extends string>(values: readonly K[]): Record<K, number> {
  return Object.fromEntries(values.map((v) => [v, 0])) as Record<K, number>;
}

// §13 of the plan.
export function classifyDisagreement(row: LlmEvaluationRow): DisagreementType {
  if (row.llmLabel === 'CRITICAL_RELEVANT' && row.cheapFilterDecision === 'DROP') {
    return 'false_negative_risk';
  }
  if (row.llmLabel === 'CRITICAL_RELEVANT' && row.cheapFilterScore < 40) {
    return 'under_scored_critical';
  }
  if (row.llmLabel === 'IRRELEVANT' && row.cheapFilterDecision === 'KEEP') {
    return 'false_positive_risk';
  }
  if (row.llmLabel === 'IRRELEVANT' && row.cheapFilterScore >= 40) {
    return 'over_scored_irrelevant';
  }
  if (row.scoreAssessment === 'REASONABLE') {
    return 'reasonable';
  }
  return 'minor_difference';
}

function topCounts(items: Array<{ key: string; count: number }>, limit: number): Array<{ [k: string]: string | number }> {
  return items
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((item) => ({ [item.key]: item.count, count: item.count }));
}

function countStringOccurrences(rows: LlmEvaluationRow[], field: 'suggestedKeywordsToAdd' | 'suggestedVendorProductAliasesToAdd'): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of row[field]) {
      // Collapse all whitespace (including newlines the LLM sometimes emits
      // inside the suggested keyword/alias strings) so each suggestion counts
      // as a single item and renders cleanly in the markdown report.
      const key = value.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

function countByVendor(rows: LlmEvaluationRow[], filter: (row: LlmEvaluationRow) => boolean): Array<{ vendor: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!filter(row)) continue;
    for (const vendor of row.cheapFilterMatchedSignals.vendors) {
      counts.set(vendor, (counts.get(vendor) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([vendor, count]) => ({ vendor, count }))
    .sort((a, b) => b.count - a.count);
}

function countBySourceTier(rows: LlmEvaluationRow[], filter: (row: LlmEvaluationRow) => boolean): Array<{ sourceTier: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!filter(row)) continue;
    const tier = row.cheapFilterMatchedSignals.sourceTier ?? 'unknown';
    counts.set(tier, (counts.get(tier) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([sourceTier, count]) => ({ sourceTier, count }))
    .sort((a, b) => b.count - a.count);
}

export function aggregateLlmEvaluations(input: AggregatorInput): LlmEvalSummary {
  const { evaluations } = input;

  const labelDistribution = emptyDistribution<LlmEvaluationLabel>(LLM_EVAL_LABEL_VALUES);
  const scoreAssessmentDistribution = emptyDistribution<ScoreAssessment>(SCORE_ASSESSMENT_VALUES);
  const disagreementDistribution = emptyDistribution<DisagreementType>(DISAGREEMENT_VALUES);
  const scoringIssueDistribution: Partial<Record<ScoringIssue, number>> = {};
  const relevanceTypeDistribution: Partial<Record<RelevanceType, number>> = {};
  const cheapDecisionDistribution: Record<string, number> = { KEEP: 0, MAYBE_KEEP: 0, DROP: 0 };

  for (const row of evaluations) {
    labelDistribution[row.llmLabel] += 1;
    scoreAssessmentDistribution[row.scoreAssessment] += 1;
    disagreementDistribution[classifyDisagreement(row)] += 1;
    scoringIssueDistribution[row.scoringIssue] = (scoringIssueDistribution[row.scoringIssue] ?? 0) + 1;
    relevanceTypeDistribution[row.relevanceType] = (relevanceTypeDistribution[row.relevanceType] ?? 0) + 1;
    cheapDecisionDistribution[row.cheapFilterDecision] = (cheapDecisionDistribution[row.cheapFilterDecision] ?? 0) + 1;
  }

  const critical = evaluations.filter((r) => r.llmLabel === 'CRITICAL_RELEVANT');
  const important = evaluations.filter((r) => r.llmLabel === 'CRITICAL_RELEVANT' || r.llmLabel === 'RELEVANT');
  const irrelevant = evaluations.filter((r) => r.llmLabel === 'IRRELEVANT');
  const borderline = evaluations.filter((r) => r.llmLabel === 'BORDERLINE');

  const criticalKept = critical.filter((r) => r.cheapFilterDecision === 'KEEP');
  const importantPassed = important.filter((r) => r.cheapFilterDecision !== 'DROP');
  const criticalUnderScored = critical.filter((r) => r.cheapFilterScore < 40);
  const irrelevantDropped = irrelevant.filter((r) => r.cheapFilterDecision === 'DROP');
  const irrelevantOverScored = irrelevant.filter((r) => r.cheapFilterScore >= 40);
  const borderlineRetained = borderline.filter((r) => r.cheapFilterDecision !== 'DROP');

  const metrics: LlmEvalSummaryMetrics = {
    totalEvaluated: evaluations.length,
    criticalRecallProxy: ratio(criticalKept.length, critical.length),
    relevantRecallProxy: ratio(importantPassed.length, important.length),
    criticalUnderScoredRate: ratio(criticalUnderScored.length, critical.length),
    irrelevantDropRate: ratio(irrelevantDropped.length, irrelevant.length),
    irrelevantOverScoredRate: ratio(irrelevantOverScored.length, irrelevant.length),
    borderlineRetentionRate: ratio(borderlineRetained.length, borderline.length),
    scoreAssessmentDistribution,
  };

  const actionableArticleIds = evaluations
    .filter((r) => r.isActionableForImpactReview)
    .map((r) => r.articleId);

  const falseNegativeRisks = evaluations.filter(
    (r) => r.llmLabel === 'CRITICAL_RELEVANT' && (r.cheapFilterDecision === 'DROP' || r.cheapFilterDecision === 'MAYBE_KEEP')
  );
  const falsePositiveRisks = evaluations.filter(
    (r) => r.llmLabel === 'IRRELEVANT' && r.cheapFilterDecision === 'KEEP'
  );

  return {
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    modelName: input.modelName,
    promptVersion: input.promptVersion,
    totalSampled: input.totalSampled,
    totalEvaluated: evaluations.length,
    totalFailed: input.totalFailed,
    articleIds: evaluations.map((r) => r.articleId),
    metrics,
    labelDistribution,
    cheapDecisionDistribution,
    disagreementDistribution,
    scoringIssueDistribution,
    relevanceTypeDistribution,
    vendorFalsePositiveCounts: countByVendor(falsePositiveRisks, () => true),
    sourceTierOverScoredCounts: countBySourceTier(evaluations, (r) => r.llmLabel === 'IRRELEVANT' && r.cheapFilterScore >= 40),
    suggestedKeywords: countStringOccurrences(evaluations, 'suggestedKeywordsToAdd'),
    suggestedAliases: countStringOccurrences(evaluations, 'suggestedVendorProductAliasesToAdd'),
    actionableArticleIds,
    falseNegativeRisks,
    falsePositiveRisks,
    sampleDisagreements: evaluations
      .filter((r) => classifyDisagreement(r) !== 'reasonable')
      .sort((a, b) => scoreAssessmentWeight(a.scoreAssessment) - scoreAssessmentWeight(b.scoreAssessment))
      .slice(0, 25),
  };
}

function scoreAssessmentWeight(s: ScoreAssessment): number {
  if (s === 'TOO_LOW') return 0;
  if (s === 'TOO_HIGH') return 1;
  return 2;
}