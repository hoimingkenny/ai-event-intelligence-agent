import { basename } from 'node:path';
import type { Queryable } from '../db/repositories/types.js';
import { EvaluationRepository } from '../db/repositories/evaluation.repository.js';
import { evaluateLabelledItems, type EvaluationMetrics } from './evaluator.js';
import { loadLabelledDataset } from './labelled-dataset-loader.js';

export interface RunEvaluationOptions {
  datasetPath: string;
  runName?: string;
  persist?: boolean;
}

export interface RunEvaluationResult {
  runId?: string;
  runName: string;
  datasetName: string;
  itemCount: number;
  metrics: EvaluationMetrics;
}

export async function runEvaluation(
  db: Queryable | null,
  options: RunEvaluationOptions
): Promise<RunEvaluationResult> {
  const items = await loadLabelledDataset(options.datasetPath);
  const metrics = evaluateLabelledItems(items);
  const runName = options.runName ?? `eval-${new Date().toISOString()}`;
  const datasetName = basename(options.datasetPath);
  let runId: string | undefined;

  if (options.persist && db) {
    runId = await new EvaluationRepository(db).createRun({
      runName,
      datasetName,
      metrics,
    });
  }

  return {
    runId,
    runName,
    datasetName,
    itemCount: items.length,
    metrics,
  };
}
