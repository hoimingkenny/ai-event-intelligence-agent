import type { PoolClient } from 'pg';
import { ArticleRepository, type ArticleRecord } from '../db/repositories/article.repository.js';
import { EntityRepository } from '../db/repositories/entity.repository.js';
import { EventRepository, type EventRecord } from '../db/repositories/event.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import {
  filterSignalsFromMatched,
  summarizeTriageSignals,
  type FilterSignalBlock,
  type TriageSignalSummary,
} from './triage-signals.js';

export type PublicationStatus = 'draft' | 'approved';

/** Slim Needs-triage list row for presence icons and draft membership. */
export interface TriageListItem {
  id: string;
  title: string | null;
  canonicalUrl: string | null;
  sourceName: string | null;
  publishedAt: Date | null;
  processingStatus: string;
  signals: TriageSignalSummary;
  draft: {
    primaryEventId: string;
    eventTitles: string[];
  } | null;
}

/** Analyst Workspace article detail (not the public catalogue article page). */
export interface WorkspaceArticleDetail {
  id: string;
  title: string | null;
  sourceName: string | null;
  canonicalUrl: string | null;
  publishedAt: Date | null;
  fetchedAt: Date | null;
  processingStatus: string;
  extractionStatus: string;
  extractionMethod: string | null;
  bodyText: string | null;
  bodySource: 'cleanText' | 'rssSummary' | null;
  cheapFilterDecision: string | null;
  llmArticleDigest: unknown;
  llmClassification: unknown;
  filterSignals: FilterSignalBlock;
  extractedEntities: Array<{
    entityType: string;
    entityValue: string;
    confidence: number | null;
    role: string | null;
  }>;
}

/** Article peek slide-over payload (fetch-on-open; slim vs full Workspace article). */
export interface ArticlePeek {
  id: string;
  title: string | null;
  sourceName: string | null;
  processingStatus: string;
  extractionStatus: string;
  excerpt: string;
  bodySource: 'cleanText' | 'rssSummary' | null;
  truncated: boolean;
  workspaceArticlePath: string;
  filterSignals: FilterSignalBlock;
  extractedEntities: Array<{
    entityType: string;
    entityValue: string;
    confidence: number | null;
    role: string | null;
  }>;
  llmDigest: string | null;
  llmEmptyReason: string | null;
}

const PEEK_EXCERPT_MAX = 700;
const PEEK_DIGEST_MAX = 500;

export function truncateArticleExcerpt(
  cleanText: string | null | undefined,
  rssSummary: string | null | undefined,
  maxChars = PEEK_EXCERPT_MAX
): {
  excerpt: string;
  bodySource: 'cleanText' | 'rssSummary' | null;
  truncated: boolean;
} {
  const clean = cleanText?.trim() ? cleanText.trim() : null;
  const rss = rssSummary?.trim() ? rssSummary.trim() : null;
  const source = clean ?? rss;
  const bodySource: 'cleanText' | 'rssSummary' | null = clean
    ? 'cleanText'
    : rss
      ? 'rssSummary'
      : null;
  if (!source) {
    return { excerpt: '', bodySource: null, truncated: false };
  }
  if (source.length <= maxChars) {
    return { excerpt: source, bodySource, truncated: false };
  }
  return {
    excerpt: `${source.slice(0, maxChars).trimEnd()}…`,
    bodySource,
    truncated: true,
  };
}

export function compactLlmDigest(
  classification: unknown,
  processingStatus: string
): { digest: string | null; emptyReason: string | null } {
  if (classification === null || classification === undefined) {
    return {
      digest: null,
      emptyReason: `No LLM digest yet (status: ${processingStatus}).`,
    };
  }

  if (typeof classification === 'object' && !Array.isArray(classification)) {
    const record = classification as Record<string, unknown>;
    const preferredKeys = [
      'relatedToMonitoredInventory',
      'incidentSummary',
      'matchedVendors',
      'matchedProducts',
      'mentionedVendors',
      'mentionedProducts',
      'affectedOrganizations',
      'cves',
      'confidence',
      'reasoning',
      'summary',
      'eventSummary',
      'headline',
      'relevance',
      'severity',
      'urgency',
      'affectedVendors',
      'affectedProducts',
    ];
    const compact: Record<string, unknown> = {};
    for (const key of preferredKeys) {
      if (key in record && record[key] !== undefined && record[key] !== null) {
        compact[key] = record[key];
      }
    }
    const payload = Object.keys(compact).length > 0 ? compact : record;
    let text = JSON.stringify(payload, null, 2);
    if (text.length > PEEK_DIGEST_MAX) {
      text = `${text.slice(0, PEEK_DIGEST_MAX).trimEnd()}…`;
    }
    return { digest: text, emptyReason: null };
  }

  let text = String(classification);
  if (text.length > PEEK_DIGEST_MAX) {
    text = `${text.slice(0, PEEK_DIGEST_MAX).trimEnd()}…`;
  }
  return { digest: text, emptyReason: null };
}

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
): Promise<WorkspacePage<TriageListItem>> {
  const { limit, offset } = normalizePageOptions(options);
  const events = new EventRepository(db);
  const entities = new EntityRepository(db);
  const [rows, total] = await Promise.all([
    events.listArticlesNeedingTriageSlim(limit, offset),
    events.countArticlesNeedingTriage(),
  ]);

  const articleIds = rows.map((row) => row.id);
  const [entityHits, drafts] = await Promise.all([
    entities.listVendorProductCvesForArticles(articleIds),
    events.listDraftMembershipsForArticles(articleIds),
  ]);

  const entitiesByArticle = new Map<string, Array<{ entityType: string; entityValue: string }>>();
  for (const entity of entityHits) {
    const list = entitiesByArticle.get(entity.articleId) ?? [];
    list.push({ entityType: entity.entityType, entityValue: entity.entityValue });
    entitiesByArticle.set(entity.articleId, list);
  }

  const draftsByArticle = new Map<
    string,
    Array<{ eventId: string; eventTitle: string | null }>
  >();
  for (const draft of drafts) {
    const list = draftsByArticle.get(draft.articleId) ?? [];
    list.push({ eventId: draft.eventId, eventTitle: draft.eventTitle });
    draftsByArticle.set(draft.articleId, list);
  }

  const items: TriageListItem[] = rows.map((row) => {
    const articleDrafts = draftsByArticle.get(row.id) ?? [];
    return {
      id: row.id,
      title: row.title,
      canonicalUrl: row.canonicalUrl,
      sourceName: row.sourceName,
      publishedAt: row.publishedAt,
      processingStatus: row.processingStatus,
      signals: summarizeTriageSignals(row.matchedSignals, entitiesByArticle.get(row.id) ?? []),
      draft:
        articleDrafts.length === 0
          ? null
          : {
              primaryEventId: articleDrafts[0]!.eventId,
              eventTitles: articleDrafts.map((d) => d.eventTitle?.trim() || `Event ${d.eventId}`),
            },
    };
  });

  return { items, total, limit, offset };
}

export async function getWorkspaceArticle(
  db: Queryable,
  articleId: string
): Promise<WorkspaceArticleDetail | null> {
  const result = await db.query<{
    id: string;
    title: string | null;
    source_name: string | null;
    canonical_url: string | null;
    published_at: Date | null;
    fetched_at: Date | null;
    processing_status: string;
    extraction_status: string;
    extraction_method: string | null;
    rss_summary: string | null;
    clean_text: string | null;
    llm_article_digest: unknown;
    llm_classification: unknown;
    cheap_filter_decision: string | null;
    cheap_filter_matched_signals: unknown;
  }>(
    `
      SELECT a.id, a.title, a.source_name, a.canonical_url, a.published_at, a.fetched_at,
        a.processing_status, a.extraction_status, a.extraction_method,
        a.rss_summary, a.clean_text, a.llm_article_digest, a.llm_classification,
        a.cheap_filter_decision, a.cheap_filter_matched_signals
      FROM articles a
      WHERE a.id = $1
    `,
    [articleId]
  );
  const row = result.rows[0];
  if (!row) return null;

  const entities = await db.query<{
    entity_type: string;
    entity_value: string;
    confidence: string | null;
    role: string | null;
  }>(
    `
      SELECT entity_type, entity_value, confidence, role
      FROM article_entities
      WHERE article_id = $1
      ORDER BY confidence DESC NULLS LAST, entity_type, entity_value
    `,
    [articleId]
  );

  const clean = row.clean_text?.trim() ? row.clean_text : null;
  const rss = row.rss_summary?.trim() ? row.rss_summary : null;
  const bodyText = clean ?? rss;
  const bodySource: WorkspaceArticleDetail['bodySource'] = clean
    ? 'cleanText'
    : rss
      ? 'rssSummary'
      : null;

  return {
    id: row.id,
    title: row.title,
    sourceName: row.source_name,
    canonicalUrl: row.canonical_url,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    processingStatus: row.processing_status,
    extractionStatus: row.extraction_status,
    extractionMethod: row.extraction_method,
    bodyText,
    bodySource,
    cheapFilterDecision: row.cheap_filter_decision,
    llmArticleDigest: row.llm_article_digest ?? null,
    llmClassification: row.llm_classification ?? null,
    filterSignals: filterSignalsFromMatched(row.cheap_filter_matched_signals),
    extractedEntities: entities.rows.map((e) => ({
      entityType: e.entity_type,
      entityValue: e.entity_value,
      confidence: e.confidence === null ? null : Number(e.confidence),
      role: e.role,
    })),
  };
}

export async function getArticlePeek(
  db: Queryable,
  articleId: string
): Promise<ArticlePeek | null> {
  const detail = await getWorkspaceArticle(db, articleId);
  if (!detail) return null;

  const excerptResult =
    detail.bodySource === 'cleanText'
      ? truncateArticleExcerpt(detail.bodyText, null)
      : detail.bodySource === 'rssSummary'
        ? truncateArticleExcerpt(null, detail.bodyText)
        : truncateArticleExcerpt(null, null);

  const { digest, emptyReason } = compactLlmDigest(
    detail.llmArticleDigest ?? detail.llmClassification,
    detail.processingStatus
  );

  return {
    id: detail.id,
    title: detail.title,
    sourceName: detail.sourceName,
    processingStatus: detail.processingStatus,
    extractionStatus: detail.extractionStatus,
    excerpt: excerptResult.excerpt,
    bodySource: excerptResult.bodySource,
    truncated: excerptResult.truncated,
    workspaceArticlePath: `/workspace/articles/${detail.id}`,
    filterSignals: detail.filterSignals,
    extractedEntities: detail.extractedEntities,
    llmDigest: digest,
    llmEmptyReason: emptyReason,
  };
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
