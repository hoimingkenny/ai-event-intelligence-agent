import type { Queryable } from '../db/repositories/types.js';

/**
 * Read model for the events view of the portal. An event is a deduplicated
 * real-world incident; its "sources" are the articles the grouping ladder
 * attached to it. Multi-source events (corroborated by several outlets) are
 * surfaced first. All queries are parameterized.
 */

export interface EventListItem {
  id: string;
  eventTitle: string | null;
  severity: string | null;
  urgency: string | null;
  confidence: number | null;
  sourceCount: number;
  affectedVendors: string[];
  cves: string[];
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export interface EventsSummary {
  total: number;
  multiSource: number;
  bySeverity: Record<string, number>;
}

export interface EventsOverview {
  generatedAt: Date;
  summary: EventsSummary;
  items: EventListItem[];
  filtered: number;
  limit: number;
  offset: number;
}

export interface EventsQuery {
  minSources?: number;
  severity?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
  sort?: 'sources_desc' | 'recent' | 'severity';
}

export interface EventSource {
  articleId: string;
  sourceName: string | null;
  title: string | null;
  canonicalUrl: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
  isPrimarySource: boolean;
  isMaterialUpdate: boolean;
  relationship: string | null;
}

export interface EventDetail extends EventListItem {
  eventSummary: string | null;
  eventStatus: string;
  affectedProducts: string[];
  attackTypes: string[];
  groupingKey: string | null;
  sources: EventSource[];
}

const MAX_LIMIT = 200;

export async function loadEventsOverview(
  db: Queryable,
  query: EventsQuery = {}
): Promise<EventsOverview> {
  const limit = clamp(query.limit ?? 50, 1, MAX_LIMIT);
  const offset = Math.max(0, query.offset ?? 0);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.minSources !== undefined) {
    params.push(query.minSources);
    conditions.push(`source_count >= $${params.length}`);
  }
  if (query.severity) {
    params.push(query.severity);
    conditions.push(`severity = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`event_title ILIKE $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderBy =
    query.sort === 'recent'
      ? 'last_seen_at DESC NULLS LAST, id DESC'
      : query.sort === 'severity'
        ? "array_position(ARRAY['critical','high','medium','low'], severity), last_seen_at DESC NULLS LAST"
        : // default: multi-source events first (the "same event, many sources" case)
          'source_count DESC, last_seen_at DESC NULLS LAST, id DESC';

  const listParams = [...params, limit, offset];
  const listResult = await db.query<EventRow>(
    `
      SELECT id, event_title, severity, urgency, confidence, source_count,
        affected_vendors, cves, first_seen_at, last_seen_at
      FROM cyber_events
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
    `,
    listParams
  );

  const filteredResult = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM cyber_events ${where}`,
    params
  );

  const summary = await loadSummary(db);

  return {
    generatedAt: new Date(),
    summary,
    items: listResult.rows.map(mapListItem),
    filtered: Number(filteredResult.rows[0]?.count ?? 0),
    limit,
    offset,
  };
}

export async function loadEventDetail(db: Queryable, eventId: string): Promise<EventDetail | null> {
  const result = await db.query<EventRow & DetailRow>(
    `
      SELECT id, event_title, event_summary, event_status, severity, urgency, confidence,
        source_count, affected_vendors, affected_products, cves, attack_types, grouping_key,
        first_seen_at, last_seen_at
      FROM cyber_events
      WHERE id = $1
    `,
    [eventId]
  );
  const row = result.rows[0];
  if (!row) return null;

  // Sources ordered as a timeline: first report → follow-ups.
  const sources = await db.query<SourceRow>(
    `
      SELECT ea.article_id, a.source_name, a.title, a.canonical_url, a.published_at, a.fetched_at,
        ea.is_primary_source, ea.is_material_update, ea.relationship
      FROM event_articles ea
      JOIN articles a ON a.id = ea.article_id
      WHERE ea.event_id = $1
      ORDER BY a.published_at ASC NULLS LAST, a.fetched_at ASC
    `,
    [eventId]
  );

  return {
    ...mapListItem(row),
    eventSummary: row.event_summary,
    eventStatus: row.event_status,
    affectedProducts: row.affected_products ?? [],
    attackTypes: row.attack_types ?? [],
    groupingKey: row.grouping_key,
    sources: sources.rows.map((s) => ({
      articleId: s.article_id,
      sourceName: s.source_name,
      title: s.title,
      canonicalUrl: s.canonical_url,
      publishedAt: s.published_at,
      fetchedAt: s.fetched_at,
      isPrimarySource: s.is_primary_source,
      isMaterialUpdate: s.is_material_update,
      relationship: s.relationship,
    })),
  };
}

interface EventRow {
  id: string;
  event_title: string | null;
  severity: string | null;
  urgency: string | null;
  confidence: string | null;
  source_count: string | number;
  affected_vendors: string[] | null;
  cves: string[] | null;
  first_seen_at: Date | null;
  last_seen_at: Date | null;
}

interface DetailRow {
  event_summary: string | null;
  event_status: string;
  affected_products: string[] | null;
  attack_types: string[] | null;
  grouping_key: string | null;
}

interface SourceRow {
  article_id: string;
  source_name: string | null;
  title: string | null;
  canonical_url: string | null;
  published_at: Date | null;
  fetched_at: Date;
  is_primary_source: boolean;
  is_material_update: boolean;
  relationship: string | null;
}

function mapListItem(row: EventRow): EventListItem {
  return {
    id: row.id,
    eventTitle: row.event_title,
    severity: row.severity,
    urgency: row.urgency,
    confidence: row.confidence === null ? null : Number(row.confidence),
    sourceCount: Number(row.source_count),
    affectedVendors: row.affected_vendors ?? [],
    cves: row.cves ?? [],
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

async function loadSummary(db: Queryable): Promise<EventsSummary> {
  const [totals, bySev] = await Promise.all([
    db.query<{ total: string; multi_source: string }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE source_count > 1) AS multi_source FROM cyber_events`
    ),
    db.query<{ severity: string | null; count: string }>(
      `SELECT severity, count(*) AS count FROM cyber_events GROUP BY severity`
    ),
  ]);

  const bySeverity: Record<string, number> = {};
  for (const row of bySev.rows) {
    if (row.severity) bySeverity[row.severity] = Number(row.count);
  }
  return {
    total: Number(totals.rows[0]?.total ?? 0),
    multiSource: Number(totals.rows[0]?.multi_source ?? 0),
    bySeverity,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
