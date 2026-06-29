import { ArticleRepository } from '../db/repositories/article.repository.js';
import { EntityRepository } from '../db/repositories/entity.repository.js';
import { EventRepository } from '../db/repositories/event.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { buildEventDraft } from '../events/event-grouper.js';

export interface EventStageResult {
  reviewed: number;
  created: number;
  attached: number;
  duplicateSkipped: number;
}

export async function runEventStage(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<EventStageResult> {
  const articles = new ArticleRepository(db);
  const entities = new EntityRepository(db);
  const events = new EventRepository(db);
  const candidates = [
    ...(await articles.listByProcessingStatus('EMBEDDED', options.limit ?? 20)),
    ...(await articles.listByProcessingStatus('ENTITY_EXTRACTED', options.limit ?? 20)),
  ].slice(0, options.limit ?? 20);
  let created = 0;
  let attached = 0;
  let duplicateSkipped = 0;

  for (const article of candidates) {
    if (article.processingStatus === 'DUPLICATE') {
      duplicateSkipped += 1;
      continue;
    }

    const articleEntities = await entities.listForArticle(article.id);
    const draft = buildEventDraft(article, articleEntities);
    let event = await events.findOpenByTitle(draft.title);

    if (!event) {
      event = await events.createEvent({
        eventTitle: draft.title,
        eventSummary: draft.summary,
        severity: draft.severity,
        urgency: draft.urgency,
        confidence: 0.6,
        affectedVendors: draft.affectedVendors,
        affectedProducts: draft.affectedProducts,
        cves: draft.cves,
        attackTypes: draft.attackTypes,
      });
      created += 1;
    }

    await events.attachArticle({
      eventId: event.id,
      articleId: article.id,
      relationship: 'same_event',
      confidence: 0.6,
      isPrimarySource: created > 0,
    });
    await articles.updateProcessingStatus(article.id, 'GROUPED');
    attached += 1;
  }

  return {
    reviewed: candidates.length,
    created,
    attached,
    duplicateSkipped,
  };
}
