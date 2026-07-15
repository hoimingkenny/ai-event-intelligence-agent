import { decideCheapFilter } from '../../src/pipeline/filter-stage.js';
import { loadMonitoredVendors } from '../../src/storage/vendorInventory.js';
import { buildConfusionMatrix } from './confusionMatrix.js';
import { inferFailureBucket, suggestFix } from './failureBuckets.js';
import {
  CHEAP_FILTER_DECISIONS,
  HUMAN_LABELS,
  SOURCE_TIERS,
  type CheapFilterEvaluationGate,
  type CheapFilterEvaluationReport,
  type CheapFilterEvaluationResult,
  type CheapFilterEvaluationSample,
  type CheapFilterEvaluationThresholds,
  type EvaluationMetrics,
  type FailureSeverity,
  type FailureType,
} from '../types/cheap-filter-eval.types.js';

export const DEFAULT_CHEAP_FILTER_THRESHOLDS: CheapFilterEvaluationThresholds = {
  criticalRecall: 0.99,
  relevantRecall: 0.95,
  criticalMissRate: 0.01,
  reasonCodeCoverage: 1,
};

export function runCheapFilterOnSample(sample: CheapFilterEvaluationSample): CheapFilterEvaluationResult {
  const decision = decideCheapFilter({
    title: sample.title,
    rssSummary: sample.rssSummary,
    rssCategories: sample.rssCategories,
    sourceName: sample.sourceName,
    sourceTier: sample.sourceTier,
    publishedAt: sample.publishedAt ? new Date(sample.publishedAt) : null,
  }, loadMonitoredVendors());
  const failureType = determineFailureType(sample.humanLabel, decision.decision);
  const severity = failureType ? severityForFailureType(failureType) : null;
  const preliminary = {
    sample,
    decision: decision.decision,
    score: decision.score,
    blockingReasons: decision.blockingReasons,
    matchedSignals: decision.matchedSignals,
  };
  const failureBucket = failureType ? inferFailureBucket(preliminary) : 'unknown';

  return {
    sample,
    id: sample.id,
    title: sample.title,
    sourceName: sample.sourceName,
    sourceTier: sample.sourceTier,
    rssSummary: sample.rssSummary,
    humanLabel: sample.humanLabel,
    humanReason: sample.humanReason,
    decision: decision.decision,
    score: decision.score,
    reasons: decision.reasons,
    blockingReasons: decision.blockingReasons,
    matchedSignals: decision.matchedSignals,
    passed: !failureType,
    failed: Boolean(failureType),
    failureType,
    severity,
    failureBucket,
    suggestedFix: failureType ? suggestFix(failureBucket, preliminary) : 'manual_review_required',
  };
}

export function evaluateCheapFilterDataset(
  samples: CheapFilterEvaluationSample[],
  options: {
    datasetPath?: string;
    thresholds?: CheapFilterEvaluationThresholds;
    generatedAt?: string;
  } = {}
): CheapFilterEvaluationReport {
  return evaluateCheapFilterSamples(
    samples.map(runCheapFilterOnSample),
    options
  );
}

export function evaluateCheapFilterSamples(
  results: CheapFilterEvaluationResult[],
  options: {
    datasetPath?: string;
    thresholds?: CheapFilterEvaluationThresholds;
    generatedAt?: string;
  } = {}
): CheapFilterEvaluationReport {
  const thresholds = options.thresholds ?? DEFAULT_CHEAP_FILTER_THRESHOLDS;
  const metrics = calculateMetrics(results);
  const confusionMatrix = buildConfusionMatrix(results);
  const falseNegatives = results.filter((result) =>
    ['CRITICAL_RELEVANT', 'RELEVANT'].includes(result.humanLabel) && result.decision === 'DROP'
  );
  const criticalPriorityFailures = results.filter(
    (result) => result.humanLabel === 'CRITICAL_RELEVANT' && result.decision !== 'KEEP'
  );
  const failuresByType = countBy(
    results.filter((result) => result.failureType),
    (result) => result.failureType as FailureType
  );
  const failuresByBucket = countBy(
    results.filter((result) => result.failed),
    (result) => result.failureBucket
  );
  const gate = evaluateGate(metrics, criticalPriorityFailures, thresholds);

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    datasetPath: options.datasetPath ?? 'inline',
    metrics,
    confusionMatrix,
    results,
    falseNegatives,
    criticalPriorityFailures,
    countsByHumanLabel: countFromValues(results, HUMAN_LABELS, (result) => result.humanLabel),
    countsByDecision: countFromValues(results, CHEAP_FILTER_DECISIONS, (result) => result.decision),
    countsBySourceTier: countFromValues(results, SOURCE_TIERS, (result) => result.sourceTier),
    failuresByType,
    failuresByBucket,
    recommendedActions: recommendActions(failuresByBucket),
    thresholds,
    gate,
  };
}

function calculateMetrics(results: CheapFilterEvaluationResult[]): EvaluationMetrics {
  const critical = results.filter((result) => result.humanLabel === 'CRITICAL_RELEVANT');
  const important = results.filter((result) => ['CRITICAL_RELEVANT', 'RELEVANT'].includes(result.humanLabel));
  const irrelevant = results.filter((result) => result.humanLabel === 'IRRELEVANT');
  const passed = results.filter((result) => result.decision !== 'DROP');
  const keep = results.filter((result) => result.decision === 'KEEP');
  const maybeKeep = results.filter((result) => result.decision === 'MAYBE_KEEP');
  const criticalKept = critical.filter((result) => result.decision === 'KEEP');
  const importantPassed = important.filter((result) => result.decision !== 'DROP');
  const importantDropped = important.filter((result) => result.decision === 'DROP');
  const criticalMissed = critical.filter((result) => result.decision !== 'KEEP');
  const irrelevantPassed = irrelevant.filter((result) => result.decision !== 'DROP');
  const withReasonCodes = results.filter((result) => result.reasons.length > 0 || result.blockingReasons.length > 0);

  return {
    datasetSize: results.length,
    criticalRecall: ratio(criticalKept.length, critical.length),
    relevantRecall: ratio(importantPassed.length, important.length),
    falseNegativeRate: ratio(importantDropped.length, important.length),
    criticalMissRate: ratio(criticalMissed.length, critical.length),
    passThroughRate: ratio(passed.length, results.length),
    keepRate: ratio(keep.length, results.length),
    maybeKeepRate: ratio(maybeKeep.length, results.length),
    irrelevantPassRate: ratio(irrelevantPassed.length, irrelevant.length),
    reasonCodeCoverage: ratio(withReasonCodes.length, results.length),
  };
}

function determineFailureType(label: CheapFilterEvaluationSample['humanLabel'], decision: CheapFilterEvaluationResult['decision']): FailureType | null {
  if (label === 'CRITICAL_RELEVANT' && decision === 'DROP') return 'critical_dropped';
  if (label === 'CRITICAL_RELEVANT' && decision === 'MAYBE_KEEP') return 'critical_deprioritized';
  if (label === 'RELEVANT' && decision === 'DROP') return 'relevant_dropped';
  if (label === 'WEAK_RELEVANT' && decision === 'DROP') return 'weak_relevant_dropped';
  if (label === 'IRRELEVANT' && decision === 'KEEP') return 'irrelevant_kept';
  if (label === 'IRRELEVANT' && decision === 'MAYBE_KEEP') return 'irrelevant_maybe_kept';
  return null;
}

function severityForFailureType(failureType: FailureType): FailureSeverity {
  if (failureType === 'critical_dropped') return 'severe';
  if (failureType === 'critical_deprioritized' || failureType === 'relevant_dropped') return 'high';
  if (failureType === 'weak_relevant_dropped') return 'medium';
  return 'low';
}

function evaluateGate(
  metrics: EvaluationMetrics,
  criticalPriorityFailures: CheapFilterEvaluationResult[],
  thresholds: CheapFilterEvaluationThresholds
): CheapFilterEvaluationGate {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (criticalPriorityFailures.some((result) => result.decision === 'DROP')) {
    failures.push('At least one CRITICAL_RELEVANT article was DROPPED.');
  }
  if (metrics.criticalRecall < thresholds.criticalRecall) {
    failures.push(`Critical recall ${formatMetric(metrics.criticalRecall)} below threshold ${formatMetric(thresholds.criticalRecall)}.`);
  }
  if (metrics.relevantRecall < thresholds.relevantRecall) {
    failures.push(`Relevant recall ${formatMetric(metrics.relevantRecall)} below threshold ${formatMetric(thresholds.relevantRecall)}.`);
  }
  if (metrics.criticalMissRate > thresholds.criticalMissRate) {
    failures.push(`Critical miss rate ${formatMetric(metrics.criticalMissRate)} above threshold ${formatMetric(thresholds.criticalMissRate)}.`);
  }
  if (metrics.reasonCodeCoverage < thresholds.reasonCodeCoverage) {
    failures.push(`Reason-code coverage ${formatMetric(metrics.reasonCodeCoverage)} below threshold ${formatMetric(thresholds.reasonCodeCoverage)}.`);
  }
  if (metrics.datasetSize < 50) {
    warnings.push(
      `Dataset has only ${metrics.datasetSize} samples; recall/miss thresholds are statistically weak below 50. Harvest and label more via npm run eval:candidates + npm run eval:review.`
    );
  }
  if (metrics.passThroughRate > 0.6) warnings.push('Pass-through rate is above the expected MVP range; extraction cost may be high.');
  if (metrics.irrelevantPassRate > 0.5) warnings.push('Irrelevant pass rate is high; tune only after recall is safe.');

  return { passed: failures.length === 0, failures, warnings };
}

function recommendActions(failuresByBucket: Partial<Record<string, number>>): string[] {
  const actions: string[] = [];
  if (failuresByBucket.missing_product_alias) actions.push('Add missing product aliases.');
  if (failuresByBucket.missing_vendor_alias) actions.push('Add missing vendor aliases.');
  if (failuresByBucket.missing_critical_phrase) actions.push('Move missing urgent phrases into the critical keyword group.');
  if (failuresByBucket.negative_keyword_overpowered) actions.push('Reduce negative keyword penalty or make it context-aware.');
  if (failuresByBucket.threshold_too_high) actions.push('Lower MAYBE_KEEP threshold or increase trusted-source boosts.');
  if (failuresByBucket.rss_summary_too_short || failuresByBucket.signal_only_in_body) {
    actions.push('Use shadow sampling for DROPs with vague RSS metadata.');
  }
  if (actions.length === 0) actions.push('No targeted tuning action found; continue adding reviewed samples.');
  return actions;
}

function countFromValues<T, K extends string>(items: T[], values: readonly K[], key: (item: T) => K): Record<K, number> {
  const counts = Object.fromEntries(values.map((value) => [value, 0])) as Record<K, number>;
  for (const item of items) counts[key(item)] += 1;
  return counts;
}

function countBy<T, K extends string>(items: T[], key: (item: T) => K): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function formatMetric(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
