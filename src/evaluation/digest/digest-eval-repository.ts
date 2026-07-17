import type { Queryable } from '../../db/repositories/types.js';
import type { DigestEvalMode } from '../../../eval/types/digest-eval.types.js';
import type { DigestEvalPredictionFields } from '../../../eval/types/digest-eval.types.js';

interface RunRow {
  id: string;
  mode: DigestEvalMode;
  prompt_version: string;
  model_name: string | null;
  gold_count: number;
  cli_args: Record<string, unknown>;
  comparison_baseline_run_id: string | null;
  started_at: Date;
  finished_at: Date | null;
  total_predictions_saved: number;
  total_predictions_failed: number;
}

export interface DigestEvalRunRecord {
  id: string;
  mode: DigestEvalMode;
  promptVersion: string;
  modelName: string | null;
  goldCount: number;
  cliArgs: Record<string, unknown>;
  comparisonBaselineRunId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  totalPredictionsSaved: number;
  totalPredictionsFailed: number;
}

export interface CreateDigestEvalRunInput {
  mode: DigestEvalMode;
  promptVersion: string;
  modelName?: string | null;
  goldCount: number;
  cliArgs?: Record<string, unknown>;
  comparisonBaselineRunId?: string | null;
}

export interface DigestEvalPredictionRecord {
  id: string;
  runId: string;
  articleId: string;
  prediction: DigestEvalPredictionFields | null;
  errorMessage: string | null;
  createdAt: Date;
}

function mapRun(row: RunRow): DigestEvalRunRecord {
  return {
    id: row.id,
    mode: row.mode,
    promptVersion: row.prompt_version,
    modelName: row.model_name,
    goldCount: row.gold_count,
    cliArgs: row.cli_args ?? {},
    comparisonBaselineRunId: row.comparison_baseline_run_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    totalPredictionsSaved: row.total_predictions_saved,
    totalPredictionsFailed: row.total_predictions_failed,
  };
}

export class DigestEvalRepository {
  constructor(private readonly db: Queryable) {}

  async createRun(input: CreateDigestEvalRunInput): Promise<DigestEvalRunRecord> {
    const result = await this.db.query<RunRow>(
      `
        INSERT INTO digest_eval_runs (
          mode, prompt_version, model_name, gold_count, cli_args, comparison_baseline_run_id
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        RETURNING id, mode, prompt_version, model_name, gold_count, cli_args,
          comparison_baseline_run_id, started_at, finished_at,
          total_predictions_saved, total_predictions_failed
      `,
      [
        input.mode,
        input.promptVersion,
        input.modelName ?? null,
        input.goldCount,
        JSON.stringify(input.cliArgs ?? {}),
        input.comparisonBaselineRunId ?? null,
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error('digest eval run insert returned no row');
    return mapRun(row);
  }

  async completeRun(
    runId: string,
    stats: { saved: number; failed: number }
  ): Promise<void> {
    await this.db.query(
      `
        UPDATE digest_eval_runs
        SET finished_at = now(),
          total_predictions_saved = $2,
          total_predictions_failed = $3
        WHERE id = $1
      `,
      [runId, stats.saved, stats.failed]
    );
  }

  async findRunById(runId: string): Promise<DigestEvalRunRecord | null> {
    const result = await this.db.query<RunRow>(
      `
        SELECT id, mode, prompt_version, model_name, gold_count, cli_args,
          comparison_baseline_run_id, started_at, finished_at,
          total_predictions_saved, total_predictions_failed
        FROM digest_eval_runs
        WHERE id = $1
      `,
      [runId]
    );
    const row = result.rows[0];
    return row ? mapRun(row) : null;
  }

  async findLatestRun(mode: DigestEvalMode): Promise<DigestEvalRunRecord | null> {
    const result = await this.db.query<RunRow>(
      `
        SELECT id, mode, prompt_version, model_name, gold_count, cli_args,
          comparison_baseline_run_id, started_at, finished_at,
          total_predictions_saved, total_predictions_failed
        FROM digest_eval_runs
        WHERE mode = $1 AND finished_at IS NOT NULL
        ORDER BY finished_at DESC
        LIMIT 1
      `,
      [mode]
    );
    const row = result.rows[0];
    return row ? mapRun(row) : null;
  }

  async listFinishedRuns(options: { limit?: number } = {}): Promise<DigestEvalRunRecord[]> {
    const limit = options.limit ?? 50;
    const result = await this.db.query<RunRow>(
      `
        SELECT id, mode, prompt_version, model_name, gold_count, cli_args,
          comparison_baseline_run_id, started_at, finished_at,
          total_predictions_saved, total_predictions_failed
        FROM digest_eval_runs
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at DESC
        LIMIT $1
      `,
      [limit]
    );
    return result.rows.map(mapRun);
  }

  async savePrediction(input: {
    runId: string;
    articleId: string;
    prediction: DigestEvalPredictionFields | null;
    errorMessage?: string | null;
  }): Promise<void> {
    await this.db.query(
      `
        INSERT INTO digest_eval_predictions (run_id, article_id, prediction_json, error_message)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (run_id, article_id) DO UPDATE SET
          prediction_json = EXCLUDED.prediction_json,
          error_message = EXCLUDED.error_message
      `,
      [
        input.runId,
        input.articleId,
        input.prediction ? JSON.stringify(input.prediction) : null,
        input.errorMessage ?? null,
      ]
    );
  }

  async listPredictionsForRun(runId: string): Promise<DigestEvalPredictionRecord[]> {
    const result = await this.db.query<{
      id: string;
      run_id: string;
      article_id: string;
      prediction_json: DigestEvalPredictionFields | null;
      error_message: string | null;
      created_at: Date;
    }>(
      `
        SELECT id, run_id, article_id, prediction_json, error_message, created_at
        FROM digest_eval_predictions
        WHERE run_id = $1
        ORDER BY article_id ASC
      `,
      [runId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      articleId: row.article_id,
      prediction: row.prediction_json,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    }));
  }
}
