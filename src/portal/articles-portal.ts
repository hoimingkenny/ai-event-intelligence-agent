import type { Queryable } from '../db/repositories/types.js';

/**
 * Public catalogue read model for articles. Only articles attached to at least
 * one **approved** canonical event are listed. All queries are parameterized.
 */

export interface ArticleListItem {
  id: string;
  title: string | null;
  sourceName: string | null;
  canonicalUrl: string | null;
  processingStatus: string;
  cheapFilterDecision: string | null;
  extractionStatus: string;
  extractionMethod: string | null;
  contentQualityScore: number | null;
  rssRecall: number | null;
  cleanTextLength: number;
  publishedAt: Date | null;
  fetchedAt: Date;
  extractedAt: Date | null;
  // Vendor relevance: how strongly the article relates to a monitored vendor,
  // and which one is the closest match. Derived live from the highest-
  // confidence monitored-vendor entity (confidence already blends placement +
  // corroboration). Null when no monitored vendor was detected.
  topVendor: string | null;
  vendorRelevance: number | null;
}

export interface ArticlesSummary {
  total: number;
  byStatus: Record<string, number>;
  extractionFailureRate: number;
  medianRssRecall: number | null;
  medianQuality: number | null;
}

export interface ArticlesOverview {
  generatedAt: Date;
  summary: ArticlesSummary;
  items: ArticleListItem[];
  filtered: number;
  limit: number;
  offset: number;
  sources: string[];
  statuses: string[];
  cheapFilterDecisions: string[];
}

export interface ArticlesQuery {
  status?: string | null;
  cheapFilterDecision?: string | null;
  source?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
  sort?: 'recent' | 'quality_asc' | 'recall_asc' | 'vendor_desc';
}

const MAX_LIMIT = 200;
const PUBLIC_EVENT_IMPACT_CONDITION =
  "(cardinality(coalesce(e.affected_vendors, '{}'::text[])) > 0 OR cardinality(coalesce(e.affected_products, '{}'::text[])) > 0)";
const PUBLIC_APPROVED_EVENT_CONDITION = `e.publication_status = 'approved' AND ${PUBLIC_EVENT_IMPACT_CONDITION}`;
const PUBLIC_ARTICLE_CONDITION = `EXISTS (
        SELECT 1
        FROM event_articles ea
        JOIN cyber_events e ON e.id = ea.event_id
        WHERE ea.article_id = a.id
          AND ${PUBLIC_APPROVED_EVENT_CONDITION}
      )`;

export async function loadArticlesOverview(
  db: Queryable,
  query: ArticlesQuery = {}
): Promise<ArticlesOverview> {
  const limit = clamp(query.limit ?? 50, 1, MAX_LIMIT);
  const offset = Math.max(0, query.offset ?? 0);

  // Build a parameterized WHERE from optional filters. Columns are aliased `a.`
  // to match the `articles a` alias used in both list and count queries.
  const conditions: string[] = [PUBLIC_ARTICLE_CONDITION];
  const params: unknown[] = [];
  if (query.status) {
    params.push(query.status);
    conditions.push(`a.processing_status = $${params.length}`);
  }
  if (query.cheapFilterDecision) {
    params.push(query.cheapFilterDecision);
    conditions.push(`a.cheap_filter_decision = $${params.length}`);
  }
  if (query.source) {
    params.push(query.source);
    conditions.push(`a.source_name = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(a.title ILIKE $${params.length} OR a.canonical_url ILIKE $${params.length})`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const orderBy =
    query.sort === 'quality_asc'
      ? 'content_quality_score ASC NULLS FIRST, fetched_at DESC'
      : query.sort === 'recall_asc'
        ? 'rss_recall ASC NULLS FIRST, fetched_at DESC'
        : query.sort === 'vendor_desc'
          ? 'vendor_relevance DESC NULLS LAST, fetched_at DESC'
          : 'published_at DESC NULLS LAST, fetched_at DESC, id DESC';

  // LATERAL join surfaces the single strongest monitored-vendor match per
  // article (the "closest" vendor + its confidence) from the entities already
  // produced by the pipeline — no extra column or migration, always current.
  const listParams = [...params, limit, offset];
  const listResult = await db.query<ArticleRow>(
    `
      SELECT a.id, a.title, a.source_name, a.canonical_url, a.processing_status, a.cheap_filter_decision,
        a.extraction_status,
        a.extraction_method, a.content_quality_score, a.rss_recall,
        coalesce(length(a.clean_text), 0) AS clean_text_length,
        a.published_at, a.fetched_at, a.extracted_at,
        v.top_vendor, v.vendor_relevance
      FROM articles a
      LEFT JOIN LATERAL (
        SELECT entity_value AS top_vendor, confidence AS vendor_relevance
        FROM article_entities
        WHERE article_id = a.id AND entity_type = 'vendor'
        ORDER BY confidence DESC NULLS LAST, entity_value
        LIMIT 1
      ) v ON true
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
    `,
    listParams
  );

  const filteredResult = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM articles a ${where}`,
    params
  );

  const [summary, sources, statuses, cheapFilterDecisions] = await Promise.all([
    loadSummary(db),
    loadDistinct(db, 'source_name'),
    loadDistinct(db, 'processing_status'),
    loadDistinct(db, 'cheap_filter_decision'),
  ]);

  return {
    generatedAt: new Date(),
    summary,
    items: listResult.rows.map(mapListItem),
    filtered: Number(filteredResult.rows[0]?.count ?? 0),
    limit,
    offset,
    sources,
    statuses,
    cheapFilterDecisions,
  };
}

export interface ArticleDetail extends ArticleListItem {
  rssSummary: string | null;
  cleanText: string | null;
  extractionError: string | null;
  llmClassification: unknown;
  entities: Array<{ entityType: string; entityValue: string; confidence: number | null; role: string | null }>;
  events: Array<{ eventId: string; eventTitle: string | null; relationship: string | null; severity: string | null; confidence: number | null }>;
  alerts: Array<{ alertTier: string | null; alertStatus: string | null; alertReason: string | null; suppressed: boolean }>;
}

export async function loadArticleDetail(db: Queryable, articleId: string): Promise<ArticleDetail | null> {
  const result = await db.query<ArticleRow & DetailRow>(
    `
      SELECT a.id, a.title, a.source_name, a.canonical_url, a.processing_status, a.cheap_filter_decision,
        a.extraction_status,
        a.extraction_method, a.content_quality_score, a.rss_recall,
        coalesce(length(a.clean_text), 0) AS clean_text_length,
        a.published_at, a.fetched_at, a.extracted_at,
        a.rss_summary, a.clean_text, a.extraction_error, a.llm_classification,
        v.top_vendor, v.vendor_relevance
      FROM articles a
      LEFT JOIN LATERAL (
        SELECT entity_value AS top_vendor, confidence AS vendor_relevance
        FROM article_entities
        WHERE article_id = a.id AND entity_type = 'vendor'
        ORDER BY confidence DESC NULLS LAST, entity_value
        LIMIT 1
      ) v ON true
      WHERE a.id = $1
        AND ${PUBLIC_ARTICLE_CONDITION}
    `,
    [articleId]
  );
  const row = result.rows[0];
  if (!row) return null;

  const [entities, events, alerts] = await Promise.all([
    db.query<{ entity_type: string; entity_value: string; confidence: string | null; role: string | null }>(
      `SELECT entity_type, entity_value, confidence, role FROM article_entities
       WHERE article_id = $1 ORDER BY confidence DESC NULLS LAST, entity_type`,
      [articleId]
    ),
    db.query<{ event_id: string; event_title: string | null; relationship: string | null; severity: string | null; confidence: string | null }>(
      `SELECT e.id AS event_id, e.event_title, ea.relationship, e.severity, e.confidence
       FROM event_articles ea JOIN cyber_events e ON e.id = ea.event_id
       WHERE ea.article_id = $1
         AND ${PUBLIC_APPROVED_EVENT_CONDITION}`,
      [articleId]
    ),
    db.query<{ alert_tier: string | null; alert_status: string | null; alert_reason: string | null; suppressed: boolean }>(
      `SELECT a.alert_tier, a.alert_status, a.alert_reason, a.suppressed
       FROM alerts a
       JOIN event_articles ea ON ea.event_id = a.event_id
       JOIN cyber_events e ON e.id = ea.event_id
       WHERE ea.article_id = $1
         AND ${PUBLIC_APPROVED_EVENT_CONDITION}
       ORDER BY a.created_at DESC`,
      [articleId]
    ),
  ]);

  return {
    ...mapListItem(row),
    rssSummary: row.rss_summary,
    cleanText: row.clean_text,
    extractionError: row.extraction_error,
    llmClassification: row.llm_classification,
    entities: entities.rows.map((e) => ({
      entityType: e.entity_type,
      entityValue: e.entity_value,
      confidence: e.confidence === null ? null : Number(e.confidence),
      role: e.role,
    })),
    events: events.rows.map((e) => ({
      eventId: e.event_id,
      eventTitle: e.event_title,
      relationship: e.relationship,
      severity: e.severity,
      confidence: e.confidence === null ? null : Number(e.confidence),
    })),
    alerts: alerts.rows.map((a) => ({
      alertTier: a.alert_tier,
      alertStatus: a.alert_status,
      alertReason: a.alert_reason,
      suppressed: a.suppressed,
    })),
  };
}

/** Extracted clean text of one public-catalogue article (for the reader preview pane). */
export async function loadArticleCleanText(
  db: Queryable,
  articleId: string
): Promise<{ title: string | null; cleanText: string | null } | null> {
  const result = await db.query<{ title: string | null; clean_text: string | null }>(
    `SELECT a.title, a.clean_text
     FROM articles a
     WHERE a.id = $1
       AND ${PUBLIC_ARTICLE_CONDITION}`,
    [articleId]
  );
  const row = result.rows[0];
  return row ? { title: row.title, cleanText: row.clean_text } : null;
}

interface ArticleRow {
  id: string;
  title: string | null;
  source_name: string | null;
  canonical_url: string | null;
  processing_status: string;
  cheap_filter_decision: string | null;
  extraction_status: string;
  extraction_method: string | null;
  content_quality_score: string | null;
  rss_recall: string | null;
  clean_text_length: string | number;
  published_at: Date | null;
  fetched_at: Date;
  extracted_at: Date | null;
  top_vendor: string | null;
  vendor_relevance: string | null;
}

interface DetailRow {
  rss_summary: string | null;
  clean_text: string | null;
  extraction_error: string | null;
  llm_classification: unknown;
}

function mapListItem(row: ArticleRow): ArticleListItem {
  return {
    id: row.id,
    title: row.title,
    sourceName: row.source_name,
    canonicalUrl: row.canonical_url,
    processingStatus: row.processing_status,
    cheapFilterDecision: row.cheap_filter_decision,
    extractionStatus: row.extraction_status,
    extractionMethod: row.extraction_method,
    contentQualityScore: row.content_quality_score === null ? null : Number(row.content_quality_score),
    rssRecall: row.rss_recall === null ? null : Number(row.rss_recall),
    cleanTextLength: Number(row.clean_text_length),
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    extractedAt: row.extracted_at,
    topVendor: row.top_vendor,
    vendorRelevance: row.vendor_relevance === null ? null : Number(row.vendor_relevance),
  };
}

async function loadSummary(db: Queryable): Promise<ArticlesSummary> {
  const statusResult = await db.query<{ processing_status: string; count: string }>(
    `SELECT processing_status, count(*) AS count
     FROM articles a
     WHERE ${PUBLIC_ARTICLE_CONDITION}
     GROUP BY processing_status`
  );
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of statusResult.rows) {
    const n = Number(row.count);
    byStatus[row.processing_status] = n;
    total += n;
  }

  const failed = Object.entries(byStatus)
    .filter(([status]) => /FAIL/i.test(status))
    .reduce((sum, [, n]) => sum + n, 0);

  const stats = await db.query<{ median_recall: string | null; median_quality: string | null }>(
    `
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY rss_recall) AS median_recall,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY content_quality_score) AS median_quality
      FROM articles a
      WHERE ${PUBLIC_ARTICLE_CONDITION}
        AND (rss_recall IS NOT NULL OR content_quality_score IS NOT NULL)
    `
  );

  return {
    total,
    byStatus,
    extractionFailureRate: total === 0 ? 0 : failed / total,
    medianRssRecall: stats.rows[0]?.median_recall === null || stats.rows[0]?.median_recall === undefined
      ? null
      : Number(stats.rows[0].median_recall),
    medianQuality: stats.rows[0]?.median_quality === null || stats.rows[0]?.median_quality === undefined
      ? null
      : Number(stats.rows[0].median_quality),
  };
}

async function loadDistinct(
  db: Queryable,
  column: 'source_name' | 'processing_status' | 'cheap_filter_decision'
): Promise<string[]> {
  // column is a fixed literal (never user input) — safe to interpolate.
  const result = await db.query<Record<string, string | null>>(
    `SELECT DISTINCT ${column} AS value
     FROM articles a
     WHERE ${PUBLIC_ARTICLE_CONDITION}
       AND ${column} IS NOT NULL
     ORDER BY value`
  );
  return result.rows.map((r) => r.value).filter((v): v is string => Boolean(v));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
