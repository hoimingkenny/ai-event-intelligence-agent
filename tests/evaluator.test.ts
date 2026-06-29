import { describe, expect, it } from 'vitest';
import { evaluateLabelledItems, type LabelledEvaluationItem } from '../src/evaluation/evaluator.js';

const baseItem: LabelledEvaluationItem = {
  article_id: 'sample',
  title: 'Sample',
  url: 'https://example.test/sample',
  content: 'content',
  expected_event_group: 'event-1',
  predicted_event_group: 'event-1',
  is_duplicate: false,
  predicted_duplicate: false,
  is_relevant: true,
  predicted_relevant: true,
  expected_priority: 'high',
  predicted_priority: 'high',
  extraction_success: true,
  llm_called: false,
  source_to_notification_latency_seconds: 10,
};

describe('evaluateLabelledItems', () => {
  it('calculates measurable quality metrics from labelled items', () => {
    const result = evaluateLabelledItems([
      baseItem,
      {
        ...baseItem,
        article_id: 'duplicate',
        is_duplicate: true,
        predicted_duplicate: true,
        llm_called: true,
        source_to_notification_latency_seconds: 30,
      },
      {
        ...baseItem,
        article_id: 'false-positive',
        expected_event_group: 'none',
        predicted_event_group: 'event-wrong',
        is_relevant: false,
        predicted_relevant: true,
        extraction_success: false,
        source_to_notification_latency_seconds: null,
      },
    ]);

    expect(result.duplicate_reduction_rate).toBe(1);
    expect(result.event_grouping_precision).toBe(2 / 3);
    expect(result.classification_precision).toBe(2 / 3);
    expect(result.false_positive_rate).toBe(1);
    expect(result.llm_call_reduction_rate).toBeCloseTo(2 / 3);
    expect(result.extraction_success_rate).toBeCloseTo(2 / 3);
    expect(result.median_source_to_notification_latency_seconds).toBe(20);
  });

  it('handles an empty dataset without NaN metrics', () => {
    expect(evaluateLabelledItems([])).toEqual({
      duplicate_reduction_rate: 0,
      event_grouping_precision: 0,
      classification_precision: 0,
      false_positive_rate: 0,
      llm_call_reduction_rate: 0,
      extraction_success_rate: 0,
      median_source_to_notification_latency_seconds: null,
    });
  });
});
