import type { EvaluationMetrics } from '../../evaluation/evaluator.js';
import type { Queryable } from './types.js';

export interface CreateEvaluationRunInput {
  runName: string;
  datasetName: string;
  metrics: EvaluationMetrics;
}

export class EvaluationRepository {
  constructor(private readonly db: Queryable) {}

  async createRun(input: CreateEvaluationRunInput): Promise<string> {
    const metrics = input.metrics;
    const result = await this.db.query<{ id: string }>(
      `
        INSERT INTO evaluation_runs (
          run_name,
          dataset_name,
          duplicate_reduction_rate,
          event_grouping_precision,
          classification_precision,
          false_positive_rate,
          llm_call_reduction_rate,
          extraction_success_rate,
          median_source_to_notification_latency_seconds,
          metrics_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        RETURNING id
      `,
      [
        input.runName,
        input.datasetName,
        metrics.duplicate_reduction_rate,
        metrics.event_grouping_precision,
        metrics.classification_precision,
        metrics.false_positive_rate,
        metrics.llm_call_reduction_rate,
        metrics.extraction_success_rate,
        metrics.median_source_to_notification_latency_seconds,
        JSON.stringify(metrics),
      ]
    );

    return result.rows[0].id;
  }
}
