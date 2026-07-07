import type { CheapFilterDecision, CheapFilterMatchedSignals, SourceTier } from '../../src/pipeline/filter-stage.js';

export type HumanLabel = 'CRITICAL_RELEVANT' | 'RELEVANT' | 'WEAK_RELEVANT' | 'IRRELEVANT';
export type ExpectedMinimumDecision = CheapFilterDecision;

export type FailureType =
  | 'critical_dropped'
  | 'critical_deprioritized'
  | 'relevant_dropped'
  | 'weak_relevant_dropped'
  | 'irrelevant_kept'
  | 'irrelevant_maybe_kept';

export type FailureSeverity = 'severe' | 'high' | 'medium' | 'low';

export type FailureBucket =
  | 'missing_keyword'
  | 'missing_critical_phrase'
  | 'missing_vendor_alias'
  | 'missing_product_alias'
  | 'rss_summary_too_short'
  | 'source_tier_not_boosted'
  | 'keyword_too_low_weight'
  | 'negative_keyword_overpowered'
  | 'threshold_too_high'
  | 'language_variant_missing'
  | 'title_too_vague'
  | 'signal_only_in_body'
  | 'date_or_recency_issue'
  | 'normalization_bug'
  | 'source_metadata_missing'
  | 'unknown';

export type SuggestedFix =
  | 'add_missing_product_alias'
  | 'add_missing_vendor_alias'
  | 'increase_security_media_boost_or_lower_maybe_threshold'
  | 'reduce_negative_keyword_penalty'
  | 'consider_source_tier_boost_or_shadow_sampling'
  | 'move_phrase_to_critical_keyword_list'
  | 'manual_review_required';

export interface ExpectedSignals {
  monitoredVendorPresent: boolean;
  monitoredProductPresent: boolean;
  cvePresent: boolean;
  criticalSignalPresent: boolean;
  mediumSignalPresent: boolean;
}

/**
 * A pre-filled labeling candidate harvested from the live pipeline. A human only
 * needs to supply humanLabel + humanReason to turn it into a dataset sample.
 */
export interface CheapFilterCandidate {
  id: string;
  sourceName: string;
  sourceTier: SourceTier;
  url: string;
  title: string;
  rssSummary: string | null;
  rssCategories: string[];
  publishedAt: string | null;
  harvest: {
    decision: CheapFilterDecision;
    score: number | null;
    harvestedAt: string;
  };
}

export interface CheapFilterEvaluationSample {
  id: string;
  sourceName: string;
  sourceTier: SourceTier;
  url: string;
  title: string;
  rssSummary: string | null;
  rssCategories: string[];
  publishedAt: string | null;
  humanLabel: HumanLabel;
  humanReason: string;
  expectedMinimumDecision: ExpectedMinimumDecision;
  expectedSignals: ExpectedSignals;
}

export interface CheapFilterEvaluationResult {
  sample: CheapFilterEvaluationSample;
  id: string;
  title: string;
  sourceName: string;
  sourceTier: SourceTier;
  rssSummary: string | null;
  humanLabel: HumanLabel;
  humanReason: string;
  decision: CheapFilterDecision;
  score: number;
  reasons: string[];
  blockingReasons: string[];
  matchedSignals: CheapFilterMatchedSignals;
  passed: boolean;
  failed: boolean;
  failureType: FailureType | null;
  severity: FailureSeverity | null;
  failureBucket: FailureBucket;
  suggestedFix: SuggestedFix;
}

export interface EvaluationMetrics {
  datasetSize: number;
  criticalRecall: number;
  relevantRecall: number;
  falseNegativeRate: number;
  criticalMissRate: number;
  passThroughRate: number;
  keepRate: number;
  maybeKeepRate: number;
  irrelevantPassRate: number;
  reasonCodeCoverage: number;
}

export type ConfusionMatrix = Record<HumanLabel, Record<CheapFilterDecision, number>>;

export interface CheapFilterEvaluationReport {
  generatedAt: string;
  datasetPath: string;
  metrics: EvaluationMetrics;
  confusionMatrix: ConfusionMatrix;
  results: CheapFilterEvaluationResult[];
  falseNegatives: CheapFilterEvaluationResult[];
  criticalPriorityFailures: CheapFilterEvaluationResult[];
  countsByHumanLabel: Record<HumanLabel, number>;
  countsByDecision: Record<CheapFilterDecision, number>;
  countsBySourceTier: Record<SourceTier, number>;
  failuresByType: Partial<Record<FailureType, number>>;
  failuresByBucket: Partial<Record<FailureBucket, number>>;
  recommendedActions: string[];
  thresholds: CheapFilterEvaluationThresholds;
  gate: CheapFilterEvaluationGate;
}

export interface CheapFilterEvaluationThresholds {
  criticalRecall: number;
  relevantRecall: number;
  criticalMissRate: number;
  reasonCodeCoverage: number;
}

export interface CheapFilterEvaluationGate {
  passed: boolean;
  failures: string[];
  warnings: string[];
}

export const HUMAN_LABELS: HumanLabel[] = ['CRITICAL_RELEVANT', 'RELEVANT', 'WEAK_RELEVANT', 'IRRELEVANT'];
export const CHEAP_FILTER_DECISIONS: CheapFilterDecision[] = ['KEEP', 'MAYBE_KEEP', 'DROP'];
export const SOURCE_TIERS: SourceTier[] = [
  'official_vendor',
  'government_cert',
  'security_media',
  'researcher_blog',
  'general_news',
  'unknown',
];
