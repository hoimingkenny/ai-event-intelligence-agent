import type { Queryable } from './types.js';

export type AnalysisTaskStatus = 'pending' | 'running' | 'completed' | 'needs_attention';
export type AnalysisTaskName = 'article_summary' | 'article_disposition' | 'article_cve_interpretation';

export interface AnalysisTaskRecord {
  id: string;
  targetType: string;
  targetId: string;
  taskName: string;
  status: AnalysisTaskStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  inputPayload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  promptVersion: string | null;
  model: string | null;
  lastError: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalysisTaskInput {
  targetType: string;
  targetId: string;
  taskName: string;
  inputPayload?: Record<string, unknown>;
  maxAttempts?: number;
  nextAttemptAt?: Date | null;
  promptVersion?: string | null;
  model?: string | null;
}

interface AnalysisTaskRow {
  id: string;
  target_type: string;
  target_id: string;
  task_name: string;
  status: AnalysisTaskStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date | null;
  input_payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  prompt_version: string | null;
  model: string | null;
  last_error: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const DEFAULT_ANALYSIS_TASK_MAX_ATTEMPTS = 5;

export class AnalysisTaskRepository {
  constructor(private readonly db: Queryable) {}

  async upsertPending(input: AnalysisTaskInput): Promise<AnalysisTaskRecord> {
    const maxAttempts = input.maxAttempts ?? DEFAULT_ANALYSIS_TASK_MAX_ATTEMPTS;
    const result = await this.db.query<AnalysisTaskRow>(
      `
        INSERT INTO analysis_tasks (
          target_type, target_id, task_name, status, attempts, max_attempts,
          next_attempt_at, input_payload, prompt_version, model
        )
        VALUES ($1, $2, $3, 'pending', 0, $4, $5, $6::jsonb, $7, $8)
        ON CONFLICT (target_type, target_id, task_name) DO UPDATE
          SET input_payload = EXCLUDED.input_payload,
              next_attempt_at = COALESCE(EXCLUDED.next_attempt_at, analysis_tasks.next_attempt_at),
              prompt_version = COALESCE(EXCLUDED.prompt_version, analysis_tasks.prompt_version),
              model = COALESCE(EXCLUDED.model, analysis_tasks.model),
              updated_at = now()
          WHERE analysis_tasks.status IN ('needs_attention')
        RETURNING id, target_type, target_id, task_name, status, attempts, max_attempts,
          next_attempt_at, input_payload, result, prompt_version, model, last_error,
          completed_at, created_at, updated_at
      `,
      [
        input.targetType,
        input.targetId,
        input.taskName,
        maxAttempts,
        input.nextAttemptAt ?? null,
        JSON.stringify(input.inputPayload ?? {}),
        input.promptVersion ?? null,
        input.model ?? null,
      ]
    );

    if (result.rows[0]) {
      return mapRow(result.rows[0]);
    }

    const existing = await this.db.query<AnalysisTaskRow>(
      `
        SELECT id, target_type, target_id, task_name, status, attempts, max_attempts,
          next_attempt_at, input_payload, result, prompt_version, model, last_error,
          completed_at, created_at, updated_at
        FROM analysis_tasks
        WHERE target_type = $1 AND target_id = $2 AND task_name = $3
      `,
      [input.targetType, input.targetId, input.taskName]
    );
    if (!existing.rows[0]) {
      throw new Error(
        `Failed to upsert analysis task ${input.targetType}:${input.targetId}:${input.taskName}`
      );
    }
    return mapRow(existing.rows[0]);
  }

  async claimNextReadyTask(
    taskName: string,
    options: { now?: Date } = {}
  ): Promise<AnalysisTaskRecord | null> {
    const now = options.now ?? new Date();
    const result = await this.db.query<AnalysisTaskRow>(
      `
        WITH candidate AS (
          SELECT id
          FROM analysis_tasks
          WHERE task_name = $1
            AND status = 'pending'
            AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
          ORDER BY next_attempt_at ASC NULLS FIRST, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE analysis_tasks AS t
        SET status = 'running', updated_at = now()
        FROM candidate
        WHERE t.id = candidate.id
        RETURNING t.id, t.target_type, t.target_id, t.task_name, t.status, t.attempts,
          t.max_attempts, t.next_attempt_at, t.input_payload, t.result, t.prompt_version,
          t.model, t.last_error, t.completed_at, t.created_at, t.updated_at
      `,
      [taskName, now]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async recordSuccess(taskId: string, result: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `
        UPDATE analysis_tasks
        SET status = 'completed',
            result = $2::jsonb,
            attempts = attempts + 1,
            last_error = NULL,
            completed_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [taskId, JSON.stringify(result)]
    );
  }

  async recordFailure(taskId: string, error: string, backoffSeconds: number): Promise<AnalysisTaskStatus> {
    const result = await this.db.query<{ status: AnalysisTaskStatus; attempts: number }>(
      `
        UPDATE analysis_tasks
        SET attempts = attempts + 1,
            last_error = $2,
            status = CASE WHEN attempts + 1 >= max_attempts THEN 'needs_attention' ELSE 'pending' END,
            next_attempt_at = CASE
              WHEN attempts + 1 >= max_attempts THEN NULL
              ELSE now() + make_interval(secs => $3)
            END,
            updated_at = now()
        WHERE id = $1
        RETURNING status, attempts
      `,
      [taskId, error, backoffSeconds]
    );
    return result.rows[0]?.status ?? 'pending';
  }

  async listForTarget(targetType: string, targetId: string): Promise<AnalysisTaskRecord[]> {
    const result = await this.db.query<AnalysisTaskRow>(
      `
        SELECT id, target_type, target_id, task_name, status, attempts, max_attempts,
          next_attempt_at, input_payload, result, prompt_version, model, last_error,
          completed_at, created_at, updated_at
        FROM analysis_tasks
        WHERE target_type = $1 AND target_id = $2
        ORDER BY task_name ASC, id ASC
      `,
      [targetType, targetId]
    );
    return result.rows.map(mapRow);
  }

  async listNeedsAttentionForTarget(targetType: string, targetId: string): Promise<AnalysisTaskRecord[]> {
    const result = await this.db.query<AnalysisTaskRow>(
      `
        SELECT id, target_type, target_id, task_name, status, attempts, max_attempts,
          next_attempt_at, input_payload, result, prompt_version, model, last_error,
          completed_at, created_at, updated_at
        FROM analysis_tasks
        WHERE target_type = $1 AND target_id = $2 AND status = 'needs_attention'
        ORDER BY updated_at DESC
      `,
      [targetType, targetId]
    );
    return result.rows.map(mapRow);
  }

  async listCompletedByName(taskName: string, limit: number): Promise<AnalysisTaskRecord[]> {
    const result = await this.db.query<AnalysisTaskRow>(
      `
        SELECT id, target_type, target_id, task_name, status, attempts, max_attempts,
          next_attempt_at, input_payload, result, prompt_version, model, last_error,
          completed_at, created_at, updated_at
        FROM analysis_tasks
        WHERE task_name = $1 AND status = 'completed'
        ORDER BY completed_at ASC NULLS LAST, id ASC
        LIMIT $2
      `,
      [taskName, limit]
    );
    return result.rows.map(mapRow);
  }

  async listCompletedByTargetsAndName(
    targetType: string,
    targetIds: string[],
    taskName: string
  ): Promise<AnalysisTaskRecord[]> {
    if (targetIds.length === 0) return [];
    const result = await this.db.query<AnalysisTaskRow>(
      `
        SELECT id, target_type, target_id, task_name, status, attempts, max_attempts,
          next_attempt_at, input_payload, result, prompt_version, model, last_error,
          completed_at, created_at, updated_at
        FROM analysis_tasks
        WHERE target_type = $1 AND target_id = ANY($2::BIGINT[]) AND task_name = $3
          AND status = 'completed'
      `,
      [targetType, targetIds, taskName]
    );
    return result.rows.map(mapRow);
  }

  async findById(id: string): Promise<AnalysisTaskRecord | null> {
    const result = await this.db.query<AnalysisTaskRow>(
      `
        SELECT id, target_type, target_id, task_name, status, attempts, max_attempts,
          next_attempt_at, input_payload, result, prompt_version, model, last_error,
          completed_at, created_at, updated_at
        FROM analysis_tasks
        WHERE id = $1
      `,
      [id]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async retry(taskId: string): Promise<void> {
    await this.db.query(
      `
        UPDATE analysis_tasks
        SET status = 'pending',
            attempts = GREATEST(attempts, 0),
            next_attempt_at = now(),
            updated_at = now()
        WHERE id = $1 AND status = 'needs_attention'
      `,
      [taskId]
    );
  }

  async completeManually(taskId: string, result: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `
        UPDATE analysis_tasks
        SET status = 'completed',
            result = $2::jsonb,
            completed_at = now(),
            last_error = NULL,
            updated_at = now()
        WHERE id = $1 AND status = 'needs_attention'
      `,
      [taskId, JSON.stringify(result)]
    );
  }
}

function mapRow(row: AnalysisTaskRow): AnalysisTaskRecord {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    taskName: row.task_name,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    inputPayload: row.input_payload,
    result: row.result,
    promptVersion: row.prompt_version,
    model: row.model,
    lastError: row.last_error,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}