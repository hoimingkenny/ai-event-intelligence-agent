export interface LabelledEvaluationItem {
  article_id: string;
  title: string;
  url: string;
  content: string;
  expected_event_group: string;
  predicted_event_group: string;
  is_duplicate: boolean;
  predicted_duplicate: boolean;
  is_relevant: boolean;
  predicted_relevant: boolean;
  expected_priority: string;
  predicted_priority: string;
  extraction_success: boolean;
  llm_called: boolean;
  source_to_notification_latency_seconds: number | null;
}

export interface EvaluationMetrics {
  duplicate_reduction_rate: number;
  event_grouping_precision: number;
  classification_precision: number;
  false_positive_rate: number;
  llm_call_reduction_rate: number;
  extraction_success_rate: number;
  median_source_to_notification_latency_seconds: number | null;
}

export function evaluateLabelledItems(items: LabelledEvaluationItem[]): EvaluationMetrics {
  const total = items.length;
  const expectedDuplicates = items.filter((item) => item.is_duplicate);
  const correctlySuppressedDuplicates = expectedDuplicates.filter((item) => item.predicted_duplicate);
  const eventPredictions = items.filter((item) => item.predicted_event_group !== 'none');
  const correctEventPredictions = eventPredictions.filter(
    (item) => item.predicted_event_group === item.expected_event_group
  );
  const predictedRelevant = items.filter((item) => item.predicted_relevant);
  const truePositiveRelevant = predictedRelevant.filter((item) => item.is_relevant);
  const actualIrrelevant = items.filter((item) => !item.is_relevant);
  const falsePositiveRelevant = actualIrrelevant.filter((item) => item.predicted_relevant);
  const llmCalls = items.filter((item) => item.llm_called).length;
  const successfulExtractions = items.filter((item) => item.extraction_success).length;
  const latencies = items
    .map((item) => item.source_to_notification_latency_seconds)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);

  return {
    duplicate_reduction_rate: ratio(correctlySuppressedDuplicates.length, expectedDuplicates.length),
    event_grouping_precision: ratio(correctEventPredictions.length, eventPredictions.length),
    classification_precision: ratio(truePositiveRelevant.length, predictedRelevant.length),
    false_positive_rate: ratio(falsePositiveRelevant.length, actualIrrelevant.length),
    llm_call_reduction_rate: total === 0 ? 0 : 1 - llmCalls / total,
    extraction_success_rate: ratio(successfulExtractions, total),
    median_source_to_notification_latency_seconds: median(latencies),
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const midpoint = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[midpoint];
  return (values[midpoint - 1] + values[midpoint]) / 2;
}
