import { z } from 'zod';

// ----- Input ---------------------------------------------------------------

export const CheapFilterDecisionSchema = z.enum(['KEEP', 'MAYBE_KEEP', 'DROP']);

export const SourceTierSchema = z.enum([
  'official_vendor',
  'government_cert',
  'security_media',
  'researcher_blog',
  'general_news',
  'unknown',
]);
export type SourceTier = z.infer<typeof SourceTierSchema>;

export const CheapFilterMatchedSignalsSchema = z.object({
  criticalCyberKeywords: z.array(z.string()),
  mediumCyberKeywords: z.array(z.string()),
  lowCyberKeywords: z.array(z.string()),
  negativeKeywords: z.array(z.string()),
  cves: z.array(z.string()),
  vendors: z.array(z.string()),
  products: z.array(z.string()),
  rssCategories: z.array(z.string()),
  sourceTier: SourceTierSchema,
});

export type CheapFilterMatchedSignals = z.infer<typeof CheapFilterMatchedSignalsSchema>;

export const CheapFilterEvalInputSchema = z.object({
  articleId: z.string().min(1),
  title: z.string(),
  rssSummary: z.string().nullable(),
  rssCategories: z.array(z.string()).default([]),
  sourceName: z.string().nullable(),
  sourceTier: SourceTierSchema.optional(),
  publishedAt: z.string().nullable(),
  cheapFilterDecision: CheapFilterDecisionSchema,
  cheapFilterScore: z.number().min(0).max(100),
  matchedSignals: CheapFilterMatchedSignalsSchema,
  blockingReasons: z.array(z.string()),
});

export type CheapFilterEvalInput = z.infer<typeof CheapFilterEvalInputSchema>;

// ----- LLM judgment enums --------------------------------------------------

// Aligned with the human-label taxonomy in the eval pipeline so reports can
// cross-reference the deterministic eval and the LLM eval.
export const LlmEvaluationLabelSchema = z.enum([
  'CRITICAL_RELEVANT',
  'RELEVANT',
  'BORDERLINE',
  'IRRELEVANT',
]);
export type LlmEvaluationLabel = z.infer<typeof LlmEvaluationLabelSchema>;

export const ScoreAssessmentSchema = z.enum(['TOO_HIGH', 'REASONABLE', 'TOO_LOW']);
export type ScoreAssessment = z.infer<typeof ScoreAssessmentSchema>;

export const ScoreBandSchema = z.enum(['80-100', '60-79', '40-59', '15-39', '0-14']);
export type ScoreBand = z.infer<typeof ScoreBandSchema>;

// Tie-breaking order is enforced via the prompt rubric. The LLM picks the
// first match: active exploitation -> zero_day -> patch_or_advisory ->
// vulnerability_disclosure -> breach_or_incident -> threat_research ->
// business_noise -> general_security_news -> unclear.
export const RelevanceTypeSchema = z.enum([
  'active_exploitation',
  'zero_day',
  'patch_or_advisory',
  'vulnerability_disclosure',
  'breach_or_incident',
  'threat_research',
  'business_noise',
  'general_security_news',
  'unclear',
]);
export type RelevanceType = z.infer<typeof RelevanceTypeSchema>;

// Names that overlap with eval/utils/failureBuckets.ts where possible so
// cross-references between the deterministic eval and the LLM eval share
// vocabulary (missing_keyword matches; threshold_too_high; etc).
export const ScoringIssueSchema = z.enum([
  'none',
  'vendor_score_too_high',
  'product_score_too_high',
  'product_score_too_low',
  'critical_keyword_score_too_low',
  'medium_keyword_score_too_high',
  'noisy_vendor_penalty_too_weak',
  'negative_penalty_too_weak',
  'negative_penalty_too_strong',
  'stale_penalty_too_strong',
  'stale_penalty_too_weak',
  'source_tier_score_too_high',
  'source_tier_score_too_low',
  'missing_keyword',
  'missing_vendor_alias',
  'missing_product_alias',
  'rss_summary_too_thin',
  'ambiguous_summary',
  'threshold_too_high',
  'threshold_too_low',
  'recency_boost_too_strong',
  'rss_categories_overcounted',
  'language_variant_missing',
  'unclear',
]);
export type ScoringIssue = z.infer<typeof ScoringIssueSchema>;

// ----- LLM judgment output -------------------------------------------------

export const CheapFilterLlmEvaluationSchema = z.object({
  articleId: z.string().min(1),
  llmLabel: LlmEvaluationLabelSchema,
  expectedDecision: CheapFilterDecisionSchema,
  scoreAssessment: ScoreAssessmentSchema,
  // Null when scoreAssessment === 'REASONABLE' (no band needed).
  recommendedScoreBand: ScoreBandSchema.nullable(),
  // True only when llmLabel ∈ {CRITICAL_RELEVANT, RELEVANT} AND the cheap
  // filter decision disagrees with expectedDecision AND the disagreement is a
  // false-negative risk. See prompt rubric.
  isActionableForImpactReview: z.boolean(),
  relevanceType: RelevanceTypeSchema,
  scoringIssue: ScoringIssueSchema,
  explanation: z.string().min(1),
  suggestedRuleChanges: z.array(z.string()),
  suggestedKeywordsToAdd: z.array(z.string()),
  suggestedVendorProductAliasesToAdd: z.array(z.string()),
});

export type CheapFilterLlmEvaluation = z.infer<typeof CheapFilterLlmEvaluationSchema>;

// ----- Disagreement taxonomy (§13 of the plan) ----------------------------

export const DisagreementTypeSchema = z.enum([
  'false_negative_risk',
  'under_scored_critical',
  'false_positive_risk',
  'over_scored_irrelevant',
  'minor_difference',
  'reasonable',
]);
export type DisagreementType = z.infer<typeof DisagreementTypeSchema>;

// ----- Persistence shape ---------------------------------------------------

export interface LlmEvaluationRow {
  id: string;
  runId: string;
  articleId: string;
  cheapFilterDecision: string;
  cheapFilterScore: number;
  cheapFilterMatchedSignals: CheapFilterMatchedSignals;
  cheapFilterBlockingReasons: string[];
  llmLabel: LlmEvaluationLabel;
  expectedDecision: string;
  scoreAssessment: ScoreAssessment;
  recommendedScoreBand: ScoreBand | null;
  isActionableForImpactReview: boolean;
  relevanceType: RelevanceType;
  scoringIssue: ScoringIssue;
  explanation: string;
  suggestedRuleChanges: string[];
  suggestedKeywordsToAdd: string[];
  suggestedVendorProductAliasesToAdd: string[];
  modelName: string;
  promptVersion: string;
  rawLlmResponse: unknown;
  parseRetries: number;
  createdAt: string;
}

export interface LlmEvalRunRow {
  id: string;
  sampleSize: number;
  sinceDays: number;
  sourceTierFilter: string | null;
  decisionFilter: string | null;
  modelName: string;
  promptVersion: string;
  cliArgs: Record<string, unknown>;
  concurrency: number;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  articleIds: string[];
  totalArticlesSampled: number;
  totalEvaluationsSaved: number;
  totalEvaluationsFailed: number;
  notes: string | null;
}

// ----- Aggregator output ---------------------------------------------------

export interface LlmEvalSummaryMetrics {
  totalEvaluated: number;
  criticalRecallProxy: number;
  relevantRecallProxy: number;
  criticalUnderScoredRate: number;
  irrelevantDropRate: number;
  irrelevantOverScoredRate: number;
  borderlineRetentionRate: number;
  scoreAssessmentDistribution: Record<ScoreAssessment, number>;
}

export interface LlmEvalSummary {
  runId: string;
  generatedAt: string;
  modelName: string;
  promptVersion: string;
  totalSampled: number;
  totalEvaluated: number;
  totalFailed: number;
  articleIds: string[];
  metrics: LlmEvalSummaryMetrics;
  labelDistribution: Record<LlmEvaluationLabel, number>;
  cheapDecisionDistribution: Record<string, number>;
  disagreementDistribution: Record<DisagreementType, number>;
  scoringIssueDistribution: Partial<Record<ScoringIssue, number>>;
  relevanceTypeDistribution: Partial<Record<RelevanceType, number>>;
  vendorFalsePositiveCounts: Array<{ vendor: string; count: number }>;
  sourceTierOverScoredCounts: Array<{ sourceTier: string; count: number }>;
  suggestedKeywords: Array<{ key: string; count: number }>;
  suggestedAliases: Array<{ key: string; count: number }>;
  actionableArticleIds: string[];
  falseNegativeRisks: LlmEvaluationRow[];
  falsePositiveRisks: LlmEvaluationRow[];
  sampleDisagreements: LlmEvaluationRow[];
}

export const LLM_EVAL_LABEL_VALUES = LlmEvaluationLabelSchema.options;
export const SCORE_ASSESSMENT_VALUES = ScoreAssessmentSchema.options;
export const RELEVANCE_TYPE_VALUES = RelevanceTypeSchema.options;
export const SCORING_ISSUE_VALUES = ScoringIssueSchema.options;
export const DISAGREEMENT_VALUES = DisagreementTypeSchema.options;