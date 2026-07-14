import type { PoolClient } from 'pg';
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

type Connectable = Queryable & {
  connect: () => Promise<PoolClient>;
};

function isConnectable(db: Queryable): db is Connectable {
  return typeof (db as Connectable).connect === 'function';
}

/** Run membership write-sets atomically. Uses a pooled client when available. */
export async function withTransaction<T>(
  db: Queryable,
  work: (tx: Queryable) => Promise<T>
): Promise<T> {
  if (isConnectable(db)) {
    const client = (await db.connect()) as PoolClient;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await db.query('BEGIN');
  try {
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

/**
 * Analyst editorial seam for publication status, field edits, and article membership (ADR-0002).
 * Does not gate alerts.
 */
export async function approveEvent(db: Queryable, eventId: string): Promise<EventRecord> {
  const events = new EventRepository(db);
  const event = await events.findById(eventId);
  if (!event) {
    throw new Error(`Canonical event ${eventId} was not found`);
  }
  const vendors = event.affectedVendors ?? [];
  const products = event.affectedProducts ?? [];
  if (vendors.length === 0 && products.length === 0) {
    throw new Error('Cannot approve without at least one affected vendor or product');
  }
  return events.setPublicationStatus(eventId, 'approved');
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

export interface WorkspacePage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface WorkspaceQueueCounts {
  triage: number;
  drafts: number;
  approved: number;
}

const DEFAULT_PAGE_SIZE = 25;

function normalizePageOptions(options: { limit?: number; offset?: number } = {}): {
  limit: number;
  offset: number;
} {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_PAGE_SIZE, 100));
  const offset = Math.max(0, options.offset ?? 0);
  return { limit, offset };
}

export async function listWorkspaceEvents(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<WorkspaceEventListItem[]> {
  return new EventRepository(db).listForWorkspace(options.limit ?? 100);
}

export async function listWorkspaceEventsPage(
  db: Queryable,
  options: {
    publicationStatus: PublicationStatus;
    limit?: number;
    offset?: number;
  }
): Promise<WorkspacePage<WorkspaceEventListItem>> {
  const { limit, offset } = normalizePageOptions(options);
  const repo = new EventRepository(db);
  const [items, total] = await Promise.all([
    repo.listForWorkspacePage(options.publicationStatus, limit, offset),
    repo.countForWorkspace(options.publicationStatus),
  ]);
  return { items, total, limit, offset };
}

export async function getWorkspaceQueueCounts(db: Queryable): Promise<WorkspaceQueueCounts> {
  const repo = new EventRepository(db);
  const [triage, drafts, approved] = await Promise.all([
    repo.countArticlesNeedingTriage(),
    repo.countForWorkspace('draft'),
    repo.countForWorkspace('approved'),
  ]);
  return { triage, drafts, approved };
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
  options: { limit?: number; offset?: number } = {}
): Promise<ArticleRecord[]> {
  const { limit, offset } = normalizePageOptions({
    limit: options.limit ?? 50,
    offset: options.offset,
  });
  return new EventRepository(db).listArticlesNeedingTriage(limit, offset);
}

export async function listArticlesNeedingTriagePage(
  db: Queryable,
  options: { limit?: number; offset?: number } = {}
): Promise<WorkspacePage<ArticleRecord>> {
  const { limit, offset } = normalizePageOptions(options);
  const repo = new EventRepository(db);
  const [items, total] = await Promise.all([
    repo.listArticlesNeedingTriage(limit, offset),
    repo.countArticlesNeedingTriage(),
  ]);
  return { items, total, limit, offset };
}

export async function createEventFromArticles(
  db: Queryable,
  input: CreateEventFromArticlesInput
): Promise<EventRecord> {
  const articleIds = [...new Set(input.articleIds.map(String).filter(Boolean))];
  if (articleIds.length === 0) {
    throw new Error('Create requires at least one article');
  }

  return withTransaction(db, async (tx) => {
    const articles = await new ArticleRepository(tx).findByIds(articleIds);
    const eventTitle =
      input.eventTitle?.trim() || articles[0]?.title?.trim() || 'Untitled event';

    const events = new EventRepository(tx);
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
  });
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

  await withTransaction(db, async (tx) => {
    const events = new EventRepository(tx);
    await events.detachArticle(input.fromEventId, input.articleId);
    await events.attachArticle({
      eventId: input.toEventId,
      articleId: input.articleId,
      relationship: ANALYST_RELATIONSHIP,
      confidence: 1,
      isPrimarySource: false,
      isMaterialUpdate: false,
    });
  });
}
