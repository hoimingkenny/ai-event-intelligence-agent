import { model } from '../config/llm.js';
import { EventRepository, type EventRecord } from '../db/repositories/event.repository.js';
import { LlmAuditRepository } from '../db/repositories/llm-audit.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { summarizeEvent } from '../llm/summarizer.js';
import type { EventSummary } from '../llm/schemas.js';

export type EventSummarizer = (event: EventRecord) => Promise<EventSummary>;

export interface SummaryStageResult {
  reviewed: number;
  summarized: number;
  failed: number;
}

export async function runSummaryStage(
  db: Queryable,
  options: { limit?: number; summarizer?: EventSummarizer } = {}
): Promise<SummaryStageResult> {
  const events = new EventRepository(db);
  const audit = new LlmAuditRepository(db);
  const candidates = await events.listEventsNeedingSummary(options.limit ?? 20);
  let summarized = 0;
  let failed = 0;

  for (const event of candidates) {
    try {
      const articles = await events.listArticlesForEvent(event.id);
      const summary = options.summarizer
        ? await options.summarizer(event)
        : await summarizeEvent(event, articles);
      await events.saveLlmSummary(event.id, summary);
      await audit.insert({
        targetType: 'event',
        targetId: event.id,
        taskName: 'event_summary',
        model,
        promptVersion: 'event-summary-v2',
        requestJson: { eventId: event.id, articleIds: articles.map((article) => article.id) },
        responseJson: summary,
        validationStatus: 'valid',
      });
      summarized += 1;
    } catch (error) {
      await audit.insert({
        targetType: 'event',
        targetId: event.id,
        taskName: 'event_summary',
        model,
        promptVersion: 'event-summary-v2',
        requestJson: { eventId: event.id },
        validationStatus: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      failed += 1;
    }
  }

  return { reviewed: candidates.length, summarized, failed };
}
