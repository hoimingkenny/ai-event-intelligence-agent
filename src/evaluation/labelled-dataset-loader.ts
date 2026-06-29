import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { LabelledEvaluationItem } from './evaluator.js';

const LabelledEvaluationItemSchema = z.object({
  article_id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  content: z.string(),
  expected_event_group: z.string().min(1),
  predicted_event_group: z.string().min(1),
  is_duplicate: z.boolean(),
  predicted_duplicate: z.boolean(),
  is_relevant: z.boolean(),
  predicted_relevant: z.boolean(),
  expected_priority: z.string().min(1),
  predicted_priority: z.string().min(1),
  extraction_success: z.boolean(),
  llm_called: z.boolean(),
  source_to_notification_latency_seconds: z.number().nonnegative().nullable(),
});

const LabelledEvaluationDatasetSchema = z.array(LabelledEvaluationItemSchema);

export async function loadLabelledDataset(path: string): Promise<LabelledEvaluationItem[]> {
  const raw = await readFile(path, 'utf8');
  return LabelledEvaluationDatasetSchema.parse(JSON.parse(raw));
}
