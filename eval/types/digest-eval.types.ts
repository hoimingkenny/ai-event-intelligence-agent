import type { DigestGoldFields } from '../../src/evaluation/digest/digest-gold-types.js';

export const DIGEST_EVAL_SOFT_GATE_MIN_GOLD = 40;

export const DEFAULT_DIGEST_EVAL_SOFT_THRESHOLDS = {
  relatednessF1: 0.8,
  vendorExactMatchRate: 0.7,
  productExactMatchRate: 0.7,
  cveExactMatchRate: 0.75,
} as const;

export type DigestEvalMode = 'baseline' | 'regen';

export interface DigestEvalPredictionFields {
  relatedToMonitoredInventory: boolean;
  matchedVendors: string[];
  matchedProducts: string[];
  cves: string[];
}

export interface DigestEvalScoredSample {
  articleId: string;
  gold: DigestGoldFields;
  prediction: DigestEvalPredictionFields;
}

export interface DigestEvalSampleResult {
  articleId: string;
  gold: DigestGoldFields;
  prediction: DigestEvalPredictionFields;
  relatedMatch: boolean;
  vendorExactMatch: boolean | null;
  productExactMatch: boolean | null;
  cveExactMatch: boolean;
  vendorSetF1: number | null;
  productSetF1: number | null;
  cveSetF1: number;
  failures: string[];
}

export interface DigestEvalMetrics {
  goldCount: number;
  relatedGoldCount: number;
  relatednessPrecision: number;
  relatednessRecall: number;
  relatednessF1: number;
  vendorExactMatchRate: number | null;
  productExactMatchRate: number | null;
  cveExactMatchRate: number;
  vendorSetF1: number | null;
  productSetF1: number | null;
  cveSetF1: number;
}

export interface DigestEvalComparisonDelta {
  relatednessF1: number;
  vendorExactMatchRate: number | null;
  productExactMatchRate: number | null;
  cveExactMatchRate: number;
}

export interface DigestEvalGate {
  active: boolean;
  warnings: string[];
}

export interface DigestEvalReport {
  generatedAt: string;
  mode: DigestEvalMode;
  runId: string | null;
  promptVersion: string;
  modelName: string | null;
  goldSource: 'postgres';
  metrics: DigestEvalMetrics;
  results: DigestEvalSampleResult[];
  gate: DigestEvalGate;
  comparisonBaselineRunId: string | null;
  comparisonDelta: DigestEvalComparisonDelta | null;
}
