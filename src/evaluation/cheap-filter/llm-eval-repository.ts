import type { Queryable } from '../../db/repositories/types.js';
import type {
  CheapFilterLlmEvaluation,
  LlmEvalRunRow,
  LlmEvaluationRow,
  CheapFilterMatchedSignals,
  ScoreBand,
  LlmEvaluationLabel,
  ScoreAssessment,
  RelevanceType,
  ScoringIssue,
} from './llm-eval-types.js';

interface RunRow {
  id: string;
  sample_size: number;
  since_days: number;
  source_tier_filter: string | null;
  decision_filter: string | null;
  model_name: string;
  prompt_version: string;
  cli_args: Record<string, unknown>;
  concurrency: number;
  dry_run: boolean;
  started_at: Date;
  finished_at: Date | null;
  article_ids: string[];
  total_articles_sampled: number;
  total_evaluations_saved: number;
  total_evaluations_failed: number;
  notes: string | null;
}

interface EvaluationRowRaw {
  id: string;
  run_id: string;
  article_id: string;
  cheap_filter_decision: string;
  cheap_filter_score: number | string;
  cheap_filter_matched_signals: CheapFilterMatchedSignals;
  cheap_filter_blocking_reasons: string[];
  llm_label: LlmEvaluationLabel;
  expected_decision: string;
  score_assessment: ScoreAssessment;
  recommended_score_band: ScoreBand | null;
  is_actionable_for_impact_review: boolean;
  relevance_type: RelevanceType;
  scoring_issue: ScoringIssue;
  explanation: string;
  suggested_rule_changes: string[];
  suggested_keywords_to_add: string[];
  suggested_vendor_product_aliases_to_add: string[];
  model_name: string;
  prompt_version: string;
  raw_llm_response: unknown;
  parse_retries: number;
  created_at: Date;
}

function mapRun(row: RunRow): LlmEvalRunRow {
  return {
    id: row.id,
    sampleSize: row.sample_size,
    sinceDays: row.since_days,
    sourceTierFilter: row.source_tier_filter,
    decisionFilter: row.decision_filter,
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    cliArgs: row.cli_args,
    concurrency: row.concurrency,
    dryRun: row.dry_run,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    articleIds: row.article_ids,
    totalArticlesSampled: row.total_articles_sampled,
    totalEvaluationsSaved: row.total_evaluations_saved,
    totalEvaluationsFailed: row.total_evaluations_failed,
    notes: row.notes,
  };
}

function mapEvaluation(row: EvaluationRowRaw): LlmEvaluationRow {
  return {
    id: row.id,
    runId: row.run_id,
    articleId: row.article_id,
    cheapFilterDecision: row.cheap_filter_decision,
    cheapFilterScore: Number(row.cheap_filter_score),
    cheapFilterMatchedSignals: row.cheap_filter_matched_signals,
    cheapFilterBlockingReasons: row.cheap_filter_blocking_reasons,
    llmLabel: row.llm_label,
    expectedDecision: row.expected_decision,
    scoreAssessment: row.score_assessment,
    recommendedScoreBand: row.recommended_score_band,
    isActionableForImpactReview: row.is_actionable_for_impact_review,
    relevanceType: row.relevance_type,
    scoringIssue: row.scoring_issue,
    explanation: row.explanation,
    suggestedRuleChanges: row.suggested_rule_changes,
    suggestedKeywordsToAdd: row.suggested_keywords_to_add,
    suggestedVendorProductAliasesToAdd: row.suggested_vendor_product_aliases_to_add,
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    rawLlmResponse: row.raw_llm_response,
    parseRetries: row.parse_retries,
    createdAt: row.created_at.toISOString(),
  };
}

export interface CreateRunInput {
  sampleSize: number;
  sinceDays: number;
  sourceTierFilter: string | null;
  decisionFilter: string | null;
  modelName: string;
  promptVersion: string;
  cliArgs: Record<string, unknown>;
  concurrency: number;
  dryRun: boolean;
}

export class LlmEvalRepository {
  constructor(private readonly db: Queryable) {}

  async createRun(input: CreateRunInput): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `
        INSERT INTO cheap_filter_llm_eval_runs (
          sample_size, since_days, source_tier_filter, decision_filter,
          model_name, prompt_version, cli_args, concurrency, dry_run
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
        RETURNING id
      `,
      [
        input.sampleSize,
        input.sinceDays,
        input.sourceTierFilter,
        input.decisionFilter,
        input.modelName,
        input.promptVersion,
        JSON.stringify(input.cliArgs),
        input.concurrency,
        input.dryRun,
      ]
    );
    if (!result.rows[0]) throw new Error('Failed to create LLM eval run');
    return result.rows[0].id;
  }

  async completeRun(
    runId: string,
    summary: {
      articleIds: string[];
      totalArticlesSampled: number;
      totalEvaluationsSaved: number;
      totalEvaluationsFailed: number;
      notes?: string;
    }
  ): Promise<void> {
    await this.db.query(
      `
        UPDATE cheap_filter_llm_eval_runs
        SET finished_at = now(),
            article_ids = $2::bigint[],
            total_articles_sampled = $3,
            total_evaluations_saved = $4,
            total_evaluations_failed = $5,
            notes = $6
        WHERE id = $1
      `,
      [
        runId,
        summary.articleIds,
        summary.totalArticlesSampled,
        summary.totalEvaluationsSaved,
        summary.totalEvaluationsFailed,
        summary.notes ?? null,
      ]
    );
  }

  async saveEvaluation(input: {
    runId: string;
    articleId: string;
    evaluation: CheapFilterLlmEvaluation;
    cheapFilterDecision: string;
    cheapFilterScore: number;
    cheapFilterMatchedSignals: CheapFilterMatchedSignals;
    cheapFilterBlockingReasons: string[];
    modelName: string;
    promptVersion: string;
    rawLlmResponse: unknown;
    parseRetries: number;
  }): Promise<void> {
    await this.db.query(
      `
        INSERT INTO cheap_filter_llm_evaluations (
          run_id, article_id,
          cheap_filter_decision, cheap_filter_score,
          cheap_filter_matched_signals, cheap_filter_blocking_reasons,
          llm_label, expected_decision, score_assessment, recommended_score_band,
          is_actionable_for_impact_review, relevance_type, scoring_issue,
          explanation, suggested_rule_changes, suggested_keywords_to_add,
          suggested_vendor_product_aliases_to_add,
          model_name, prompt_version, raw_llm_response, parse_retries
        )
        VALUES (
          $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17,
          $18, $19, $20::jsonb, $21
        )
        ON CONFLICT (run_id, article_id) DO NOTHING
      `,
      [
        input.runId,
        input.articleId,
        input.cheapFilterDecision,
        input.cheapFilterScore,
        JSON.stringify(input.cheapFilterMatchedSignals),
        input.cheapFilterBlockingReasons,
        input.evaluation.llmLabel,
        input.evaluation.expectedDecision,
        input.evaluation.scoreAssessment,
        input.evaluation.recommendedScoreBand,
        input.evaluation.isActionableForImpactReview,
        input.evaluation.relevanceType,
        input.evaluation.scoringIssue,
        input.evaluation.explanation,
        input.evaluation.suggestedRuleChanges,
        input.evaluation.suggestedKeywordsToAdd,
        input.evaluation.suggestedVendorProductAliasesToAdd,
        input.modelName,
        input.promptVersion,
        JSON.stringify(input.rawLlmResponse),
        input.parseRetries,
      ]
    );
  }

  async findExistingEvaluation(params: {
    articleId: string;
    runId: string;
  }): Promise<LlmEvaluationRow | null> {
    const result = await this.db.query<EvaluationRowRaw>(
      `
        SELECT
          id, run_id, article_id,
          cheap_filter_decision, cheap_filter_score,
          cheap_filter_matched_signals, cheap_filter_blocking_reasons,
          llm_label, expected_decision, score_assessment, recommended_score_band,
          is_actionable_for_impact_review, relevance_type, scoring_issue,
          explanation, suggested_rule_changes, suggested_keywords_to_add,
          suggested_vendor_product_aliases_to_add,
          model_name, prompt_version, raw_llm_response, parse_retries, created_at
        FROM cheap_filter_llm_evaluations
        WHERE run_id = $1 AND article_id = $2
      `,
      [params.runId, params.articleId]
    );
    return result.rows[0] ? mapEvaluation(result.rows[0]) : null;
  }

  async listEvaluationsForRun(runId: string): Promise<LlmEvaluationRow[]> {
    const result = await this.db.query<EvaluationRowRaw>(
      `
        SELECT
          id, run_id, article_id,
          cheap_filter_decision, cheap_filter_score,
          cheap_filter_matched_signals, cheap_filter_blocking_reasons,
          llm_label, expected_decision, score_assessment, recommended_score_band,
          is_actionable_for_impact_review, relevance_type, scoring_issue,
          explanation, suggested_rule_changes, suggested_keywords_to_add,
          suggested_vendor_product_aliases_to_add,
          model_name, prompt_version, raw_llm_response, parse_retries, created_at
        FROM cheap_filter_llm_evaluations
        WHERE run_id = $1
        ORDER BY created_at ASC
      `,
      [runId]
    );
    return result.rows.map(mapEvaluation);
  }

  async getRun(runId: string): Promise<LlmEvalRunRow | null> {
    const result = await this.db.query<RunRow>(
      `
        SELECT
          id, sample_size, since_days, source_tier_filter, decision_filter,
          model_name, prompt_version, cli_args, concurrency, dry_run,
          started_at, finished_at, article_ids,
          total_articles_sampled, total_evaluations_saved, total_evaluations_failed, notes
        FROM cheap_filter_llm_eval_runs
        WHERE id = $1
      `,
      [runId]
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }
}