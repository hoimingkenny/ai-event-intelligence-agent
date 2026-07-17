import {
  DEFAULT_DIGEST_EVAL_SOFT_THRESHOLDS,
  DIGEST_EVAL_SOFT_GATE_MIN_GOLD,
  type DigestEvalGate,
  type DigestEvalMetrics,
  type DigestEvalPredictionFields,
  type DigestEvalReport,
  type DigestEvalSampleResult,
  type DigestEvalScoredSample,
  type DigestEvalComparisonDelta,
  type DigestEvalMode,
} from '../types/digest-eval.types.js';
import { average, setF1, setsEqual } from './set-metrics.js';

export function scoreDigestEvalSample(sample: DigestEvalScoredSample): DigestEvalSampleResult {
  const { articleId, gold, prediction } = sample;
  const relatedMatch = gold.relatedToMonitoredInventory === prediction.relatedToMonitoredInventory;
  const failures: string[] = [];

  if (!relatedMatch) {
    failures.push(
      `related: gold ${gold.relatedToMonitoredInventory ? 'yes' : 'no'}, pred ${
        prediction.relatedToMonitoredInventory ? 'yes' : 'no'
      }`
    );
  }

  let vendorExactMatch: boolean | null = null;
  let productExactMatch: boolean | null = null;
  let vendorSetF1: number | null = null;
  let productSetF1: number | null = null;

  if (gold.relatedToMonitoredInventory) {
    vendorExactMatch = setsEqual(gold.matchedVendors, prediction.matchedVendors);
    productExactMatch = setsEqual(gold.matchedProducts, prediction.matchedProducts);
    vendorSetF1 = setF1(gold.matchedVendors, prediction.matchedVendors);
    productSetF1 = setF1(gold.matchedProducts, prediction.matchedProducts);

    if (!vendorExactMatch) {
      failures.push(
        `vendors: gold [${gold.matchedVendors.join(', ')}], pred [${prediction.matchedVendors.join(', ')}]`
      );
    }
    if (!productExactMatch) {
      failures.push(
        `products: gold [${gold.matchedProducts.join(', ')}], pred [${prediction.matchedProducts.join(', ')}]`
      );
    }
  }

  const cveExactMatch = setsEqual(gold.cves, prediction.cves);
  const cveSetF1Value = setF1(gold.cves, prediction.cves);
  if (!cveExactMatch) {
    failures.push(`cves: gold [${gold.cves.join(', ')}], pred [${prediction.cves.join(', ')}]`);
  }

  return {
    articleId,
    gold,
    prediction,
    relatedMatch,
    vendorExactMatch,
    productExactMatch,
    cveExactMatch,
    vendorSetF1,
    productSetF1,
    cveSetF1: cveSetF1Value,
    failures,
  };
}

export function calculateDigestEvalMetrics(results: DigestEvalSampleResult[]): DigestEvalMetrics {
  const goldCount = results.length;
  const relatedResults = results.filter((result) => result.gold.relatedToMonitoredInventory);

  const tp = results.filter(
    (r) => r.gold.relatedToMonitoredInventory && r.prediction.relatedToMonitoredInventory
  ).length;
  const fp = results.filter(
    (r) => !r.gold.relatedToMonitoredInventory && r.prediction.relatedToMonitoredInventory
  ).length;
  const fn = results.filter(
    (r) => r.gold.relatedToMonitoredInventory && !r.prediction.relatedToMonitoredInventory
  ).length;
  const precision = tp + fp === 0 ? (tp === 0 ? 1 : 0) : tp / (tp + fp);
  const recall = tp + fn === 0 ? (tp === 0 ? 1 : 0) : tp / (tp + fn);
  const relatednessF1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const vendorExact = relatedResults
    .map((r) => r.vendorExactMatch)
    .filter((value): value is boolean => value !== null);
  const productExact = relatedResults
    .map((r) => r.productExactMatch)
    .filter((value): value is boolean => value !== null);
  const vendorSet = relatedResults
    .map((r) => r.vendorSetF1)
    .filter((value): value is number => value !== null);
  const productSet = relatedResults
    .map((r) => r.productSetF1)
    .filter((value): value is number => value !== null);

  return {
    goldCount,
    relatedGoldCount: relatedResults.length,
    relatednessPrecision: precision,
    relatednessRecall: recall,
    relatednessF1,
    vendorExactMatchRate:
      vendorExact.length === 0 ? null : vendorExact.filter(Boolean).length / vendorExact.length,
    productExactMatchRate:
      productExact.length === 0 ? null : productExact.filter(Boolean).length / productExact.length,
    cveExactMatchRate:
      goldCount === 0 ? 0 : results.filter((r) => r.cveExactMatch).length / goldCount,
    vendorSetF1: vendorSet.length === 0 ? null : average(vendorSet),
    productSetF1: productSet.length === 0 ? null : average(productSet),
    cveSetF1: goldCount === 0 ? 0 : average(results.map((r) => r.cveSetF1)),
  };
}

export function evaluateDigestEvalGate(metrics: DigestEvalMetrics): DigestEvalGate {
  if (metrics.goldCount < DIGEST_EVAL_SOFT_GATE_MIN_GOLD) {
    return {
      active: false,
      warnings: [
        `Soft gates inactive until ${DIGEST_EVAL_SOFT_GATE_MIN_GOLD} gold labels (currently ${metrics.goldCount}).`,
      ],
    };
  }

  const warnings: string[] = [];
  const thresholds = DEFAULT_DIGEST_EVAL_SOFT_THRESHOLDS;

  if (metrics.relatednessF1 < thresholds.relatednessF1) {
    warnings.push(
      `Relatedness F1 ${formatRate(metrics.relatednessF1)} is below ${formatRate(thresholds.relatednessF1)}.`
    );
  }
  if (
    metrics.vendorExactMatchRate !== null &&
    metrics.vendorExactMatchRate < thresholds.vendorExactMatchRate
  ) {
    warnings.push(
      `Vendor exact-match ${formatRate(metrics.vendorExactMatchRate)} is below ${formatRate(thresholds.vendorExactMatchRate)}.`
    );
  }
  if (
    metrics.productExactMatchRate !== null &&
    metrics.productExactMatchRate < thresholds.productExactMatchRate
  ) {
    warnings.push(
      `Product exact-match ${formatRate(metrics.productExactMatchRate)} is below ${formatRate(thresholds.productExactMatchRate)}.`
    );
  }
  if (metrics.cveExactMatchRate < thresholds.cveExactMatchRate) {
    warnings.push(
      `CVE exact-match ${formatRate(metrics.cveExactMatchRate)} is below ${formatRate(thresholds.cveExactMatchRate)}.`
    );
  }

  return { active: true, warnings };
}

export function compareDigestEvalMetrics(
  current: DigestEvalMetrics,
  baseline: DigestEvalMetrics
): DigestEvalComparisonDelta {
  return {
    relatednessF1: current.relatednessF1 - baseline.relatednessF1,
    vendorExactMatchRate:
      current.vendorExactMatchRate !== null && baseline.vendorExactMatchRate !== null
        ? current.vendorExactMatchRate - baseline.vendorExactMatchRate
        : null,
    productExactMatchRate:
      current.productExactMatchRate !== null && baseline.productExactMatchRate !== null
        ? current.productExactMatchRate - baseline.productExactMatchRate
        : null,
    cveExactMatchRate: current.cveExactMatchRate - baseline.cveExactMatchRate,
  };
}

export function evaluateDigestEvalSamples(
  samples: DigestEvalScoredSample[],
  options: {
    generatedAt?: string;
    mode?: DigestEvalMode;
    runId?: string | null;
    promptVersion?: string;
    modelName?: string | null;
    comparisonBaselineRunId?: string | null;
    comparisonBaselineMetrics?: DigestEvalMetrics | null;
  } = {}
): DigestEvalReport {
  const results = samples.map(scoreDigestEvalSample);
  const metrics = calculateDigestEvalMetrics(results);
  const gate = evaluateDigestEvalGate(metrics);
  const comparisonDelta =
    options.comparisonBaselineMetrics != null
      ? compareDigestEvalMetrics(metrics, options.comparisonBaselineMetrics)
      : null;

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    mode: options.mode ?? 'baseline',
    runId: options.runId ?? null,
    promptVersion: options.promptVersion ?? 'stored',
    modelName: options.modelName ?? null,
    goldSource: 'postgres',
    metrics,
    results,
    gate,
    comparisonBaselineRunId: options.comparisonBaselineRunId ?? null,
    comparisonDelta,
  };
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
