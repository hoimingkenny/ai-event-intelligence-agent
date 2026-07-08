import type { Queryable } from '../db/repositories/types.js';

export interface LlmEvaluationDashboardOptions {
  runId?: string;
  limit?: number;
}

export interface LlmEvaluationDashboard {
  generatedAt: Date;
  available: boolean;
  message: string | null;
  runs: LlmEvaluationRunSummary[];
  selectedRun: LlmEvaluationRunDetail | null;
}

export interface LlmEvaluationRunSummary {
  id: string;
  modelName: string;
  promptVersion: string;
  startedAt: Date;
  finishedAt: Date | null;
  totalArticlesSampled: number;
  totalEvaluationsSaved: number;
  totalEvaluationsFailed: number;
  notes: string | null;
}

export interface LlmEvaluationRunDetail extends LlmEvaluationRunSummary {
  metrics: LlmEvaluationMetrics;
  evaluations: LlmEvaluationItem[];
  issueCounts: Array<{ key: string; count: number }>;
  relevanceCounts: Array<{ key: string; count: number }>;
}

export interface LlmEvaluationMetrics {
  totalEvaluated: number;
  criticalRelevant: number;
  relevant: number;
  borderline: number;
  irrelevant: number;
  falseNegativeRisks: number;
  falsePositiveRisks: number;
  overScoredIrrelevant: number;
  underScoredCritical: number;
  actionableForImpactReview: number;
}

export interface LlmEvaluationItem {
  id: string;
  articleId: string;
  articleTitle: string | null;
  articleUrl: string | null;
  sourceName: string | null;
  publishedAt: Date | null;
  cheapFilterDecision: string;
  cheapFilterScore: number;
  llmLabel: string;
  expectedDecision: string;
  scoreAssessment: string;
  recommendedScoreBand: string | null;
  isActionableForImpactReview: boolean;
  relevanceType: string;
  scoringIssue: string;
  explanation: string;
  suggestedRuleChanges: string[];
  suggestedKeywordsToAdd: string[];
  suggestedVendorProductAliasesToAdd: string[];
  createdAt: Date;
}

interface RunRow {
  id: string;
  model_name: string;
  prompt_version: string;
  started_at: Date;
  finished_at: Date | null;
  total_articles_sampled: number;
  total_evaluations_saved: number;
  total_evaluations_failed: number;
  notes: string | null;
}

interface EvalRow {
  id: string;
  article_id: string;
  article_title: string | null;
  article_url: string | null;
  source_name: string | null;
  published_at: Date | null;
  cheap_filter_decision: string;
  cheap_filter_score: number | string;
  llm_label: string;
  expected_decision: string;
  score_assessment: string;
  recommended_score_band: string | null;
  is_actionable_for_impact_review: boolean;
  relevance_type: string;
  scoring_issue: string;
  explanation: string;
  suggested_rule_changes: string[];
  suggested_keywords_to_add: string[];
  suggested_vendor_product_aliases_to_add: string[];
  created_at: Date;
}

export async function loadLlmEvaluationDashboard(
  db: Queryable,
  options: LlmEvaluationDashboardOptions = {}
): Promise<LlmEvaluationDashboard> {
  try {
    const runResult = await db.query<RunRow>(
      `
        SELECT id, model_name, prompt_version, started_at, finished_at,
          total_articles_sampled, total_evaluations_saved, total_evaluations_failed, notes
        FROM cheap_filter_llm_eval_runs
        ORDER BY started_at DESC
        LIMIT $1
      `,
      [Math.max(1, Math.min(50, Math.trunc(options.limit ?? 20)))]
    );

    const runs = runResult.rows.map(mapRunSummary);
    const selectedRunId = options.runId ?? runs[0]?.id ?? null;
    const selectedRunSummary = selectedRunId ? runs.find((run) => run.id === selectedRunId) ?? null : null;
    const selectedRun = selectedRunSummary
      ? await loadRunDetail(db, selectedRunSummary)
      : null;

    return {
      generatedAt: new Date(),
      available: true,
      message: runs.length === 0 ? 'No LLM evaluation runs found. Run npm run eval:cheap-filter:judge first.' : null,
      runs,
      selectedRun,
    };
  } catch (error) {
    if (isMissingEvalTable(error)) {
      return {
        generatedAt: new Date(),
        available: false,
        message: 'LLM evaluation tables are not available yet. Run npm run db:migrate, then run npm run eval:cheap-filter:judge.',
        runs: [],
        selectedRun: null,
      };
    }
    throw error;
  }
}

async function loadRunDetail(
  db: Queryable,
  run: LlmEvaluationRunSummary
): Promise<LlmEvaluationRunDetail> {
  const result = await db.query<EvalRow>(
    `
      SELECT e.id, e.article_id,
        a.title AS article_title,
        a.canonical_url AS article_url,
        a.source_name,
        a.published_at,
        e.cheap_filter_decision,
        e.cheap_filter_score,
        e.llm_label,
        e.expected_decision,
        e.score_assessment,
        e.recommended_score_band,
        e.is_actionable_for_impact_review,
        e.relevance_type,
        e.scoring_issue,
        e.explanation,
        e.suggested_rule_changes,
        e.suggested_keywords_to_add,
        e.suggested_vendor_product_aliases_to_add,
        e.created_at
      FROM cheap_filter_llm_evaluations e
      LEFT JOIN articles a ON a.id = e.article_id
      WHERE e.run_id = $1
      ORDER BY
        CASE
          WHEN e.llm_label = 'CRITICAL_RELEVANT' AND e.cheap_filter_decision <> 'KEEP' THEN 0
          WHEN e.llm_label = 'IRRELEVANT' AND e.cheap_filter_decision = 'KEEP' THEN 1
          WHEN e.score_assessment <> 'REASONABLE' THEN 2
          ELSE 3
        END,
        e.created_at DESC
      LIMIT 200
    `,
    [run.id]
  );

  const evaluations = result.rows.map(mapEvaluationItem);
  return {
    ...run,
    metrics: summarizeEvaluations(evaluations),
    evaluations,
    issueCounts: countBy(evaluations.map((item) => item.scoringIssue)),
    relevanceCounts: countBy(evaluations.map((item) => item.relevanceType)),
  };
}

function summarizeEvaluations(items: LlmEvaluationItem[]): LlmEvaluationMetrics {
  return {
    totalEvaluated: items.length,
    criticalRelevant: items.filter((item) => item.llmLabel === 'CRITICAL_RELEVANT').length,
    relevant: items.filter((item) => item.llmLabel === 'RELEVANT').length,
    borderline: items.filter((item) => item.llmLabel === 'BORDERLINE').length,
    irrelevant: items.filter((item) => item.llmLabel === 'IRRELEVANT').length,
    falseNegativeRisks: items.filter((item) => item.llmLabel === 'CRITICAL_RELEVANT' && item.cheapFilterDecision !== 'KEEP').length,
    falsePositiveRisks: items.filter((item) => item.llmLabel === 'IRRELEVANT' && item.cheapFilterDecision === 'KEEP').length,
    overScoredIrrelevant: items.filter((item) => item.llmLabel === 'IRRELEVANT' && item.cheapFilterScore >= 40).length,
    underScoredCritical: items.filter((item) => item.llmLabel === 'CRITICAL_RELEVANT' && item.cheapFilterScore < 40).length,
    actionableForImpactReview: items.filter((item) => item.isActionableForImpactReview).length,
  };
}

function countBy(values: string[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function mapRunSummary(row: RunRow): LlmEvaluationRunSummary {
  return {
    id: row.id,
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    totalArticlesSampled: row.total_articles_sampled,
    totalEvaluationsSaved: row.total_evaluations_saved,
    totalEvaluationsFailed: row.total_evaluations_failed,
    notes: row.notes,
  };
}

function mapEvaluationItem(row: EvalRow): LlmEvaluationItem {
  return {
    id: row.id,
    articleId: row.article_id,
    articleTitle: row.article_title,
    articleUrl: row.article_url,
    sourceName: row.source_name,
    publishedAt: row.published_at,
    cheapFilterDecision: row.cheap_filter_decision,
    cheapFilterScore: Number(row.cheap_filter_score),
    llmLabel: row.llm_label,
    expectedDecision: row.expected_decision,
    scoreAssessment: row.score_assessment,
    recommendedScoreBand: row.recommended_score_band,
    isActionableForImpactReview: row.is_actionable_for_impact_review,
    relevanceType: row.relevance_type,
    scoringIssue: row.scoring_issue,
    explanation: row.explanation,
    suggestedRuleChanges: row.suggested_rule_changes ?? [],
    suggestedKeywordsToAdd: row.suggested_keywords_to_add ?? [],
    suggestedVendorProductAliasesToAdd: row.suggested_vendor_product_aliases_to_add ?? [],
    createdAt: row.created_at,
  };
}

function isMissingEvalTable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '42P01'
  );
}
