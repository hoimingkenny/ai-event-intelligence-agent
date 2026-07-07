import {
  CHEAP_FILTER_DECISIONS,
  HUMAN_LABELS,
  type CheapFilterEvaluationResult,
  type ConfusionMatrix,
} from '../types/cheap-filter-eval.types.js';

export function buildConfusionMatrix(results: CheapFilterEvaluationResult[]): ConfusionMatrix {
  const matrix = Object.fromEntries(
    HUMAN_LABELS.map((label) => [
      label,
      Object.fromEntries(CHEAP_FILTER_DECISIONS.map((decision) => [decision, 0])),
    ])
  ) as ConfusionMatrix;

  for (const result of results) {
    matrix[result.humanLabel][result.decision] += 1;
  }

  return matrix;
}
