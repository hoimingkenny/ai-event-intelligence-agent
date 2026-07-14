import { ArticleRepository, type ArticleRecord } from '../db/repositories/article.repository.js';
import { EventRepository, type EventRecord } from '../db/repositories/event.repository.js';
import type { Queryable } from '../db/repositories/types.js';

export type PublicationStatus = 'draft' | 'approved';

export interface EventFieldsInput {
  eventTitle: string;
  eventSummary: string | null;
  severity: string | null;
  urgency: string | null;
  affectedVendors: string[];
  affectedProducts: string[];
  cves: string[];
  attackTypes: string[];
}

export interface WorkspaceEventListItem extends EventRecord {
  sourceCount: number;
  lastSeenAt: Date | null;
}

export interface CreateEventFromArticlesInput {
  articleIds: string[];
  eventTitle?: string;
  eventSummary?: string | null;
  severity?: string | null;
  urgency?: string | null;
  affectedVendors?: string[];
  affectedProducts?: string[];
  cves?: string[];
  attackTypes?: string[];
}

const ANALYST_RELATIONSHIP = 'analyst_membership';

/**
 * Analyst editorial seam for publication status, field edits, and article membership (ADR-0002).
 * Does not gate alerts.
 */
export async function approveEvent(db: Queryable, eventId: string): Promise<EventRecord> {
  return new EventRepository(db).setPublicationStatus(eventId, 'approved');
}

export async function unpublishEvent(db: Queryable, eventId: string): Promise<EventRecord> {
  return new EventRepository(db).setPublicationStatus(eventId, 'draft');
}

export async function updateEventFields(
  db: Queryable,
  eventId: string,
  fields: EventFieldsInput
): Promise<EventRecord> {
  return new EventRepository(db).updateEventFields(eventId, fields);
}

export async function listWorkspaceEvents(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<WorkspaceEventListItem[]> {
  return new EventRepository(db).listForWorkspace(options.limit ?? 100);
}

export async function getWorkspaceEvent(db: Queryable, eventId: string): Promise<EventRecord | null> {
  return new EventRepository(db).findById(eventId);
}

export async function listWorkspaceEventArticles(
  db: Queryable,
  eventId: string
): Promise<ArticleRecord[]> {
  return new EventRepository(db).listArticlesForEvent(eventId);
}

export async function listArticlesNeedingTriage(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<ArticleRecord[]> {
  return new EventRepository(db).listArticlesNeedingTriage(options.limit ?? 50);
}

export async function createEventFromArticles(
  db: Queryable,
  input: CreateEventFromArticlesInput
): Promise<EventRecord> {
  const articleIds = [...new Set(input.articleIds.map(String).filter(Boolean))];
  if (articleIds.length === 0) {
    throw new Error('Create requires at least one article');
  }

  const articles = await new ArticleRepository(db).findByIds(articleIds);
  const eventTitle =
    input.eventTitle?.trim() || articles[0]?.title?.trim() || 'Untitled event';

  const events = new EventRepository(db);
  const event = await events.createEvent({
    eventTitle,
    eventSummary: input.eventSummary ?? null,
    severity: input.severity ?? null,
    urgency: input.urgency ?? null,
    affectedVendors: input.affectedVendors ?? [],
    affectedProducts: input.affectedProducts ?? [],
    cves: input.cves ?? [],
    attackTypes: input.attackTypes ?? [],
  });

  for (let i = 0; i < articles.length; i += 1) {
    const article = articles[i]!;
    await events.attachArticle({
      eventId: event.id,
      articleId: article.id,
      relationship: ANALYST_RELATIONSHIP,
      confidence: 1,
      isPrimarySource: i === 0,
      isMaterialUpdate: false,
    });
  }

  return event;
}

export async function attachArticleToEvent(
  db: Queryable,
  eventId: string,
  articleId: string
): Promise<void> {
  await new EventRepository(db).attachArticle({
    eventId,
    articleId,
    relationship: ANALYST_RELATIONSHIP,
    confidence: 1,
    isPrimarySource: false,
    isMaterialUpdate: false,
  });
}

export async function detachArticleFromEvent(
  db: Queryable,
  eventId: string,
  articleId: string
): Promise<void> {
  await new EventRepository(db).detachArticle(eventId, articleId);
}

export async function moveArticleBetweenEvents(
  db: Queryable,
  input: { articleId: string; fromEventId: string; toEventId: string }
): Promise<void> {
  if (input.fromEventId === input.toEventId) {
    throw new Error('Move requires distinct source and target events');
  }
  const events = new EventRepository(db);
  await events.detachArticle(input.fromEventId, input.articleId);
  await events.attachArticle({
    eventId: input.toEventId,
    articleId: input.articleId,
    relationship: ANALYST_RELATIONSHIP,
    confidence: 1,
    isPrimarySource: false,
    isMaterialUpdate: false,
  });
}
