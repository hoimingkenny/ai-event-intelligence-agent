import type { Queryable } from './types.js';

export interface LlmAuditInput {
  targetType: 'article' | 'event';
  targetId: string;
  taskName: string;
  model?: string | null;
  promptVersion: string;
  requestJson?: unknown;
  responseJson?: unknown;
  validationStatus: 'valid' | 'invalid' | 'error';
  errorMessage?: string | null;
}

export class LlmAuditRepository {
  constructor(private readonly db: Queryable) {}

  async insert(input: LlmAuditInput): Promise<void> {
    await this.db.query(
      `
        INSERT INTO llm_audit_logs (
          target_type,
          target_id,
          task_name,
          model,
          prompt_version,
          request_json,
          response_json,
          validation_status,
          error_message
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
      `,
      [
        input.targetType,
        input.targetId,
        input.taskName,
        input.model ?? null,
        input.promptVersion,
        JSON.stringify(input.requestJson ?? null),
        JSON.stringify(input.responseJson ?? null),
        input.validationStatus,
        input.errorMessage ?? null,
      ]
    );
  }
}
