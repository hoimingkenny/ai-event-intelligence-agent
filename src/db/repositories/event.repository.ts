import type { Queryable } from './types.js';
import { vectorToSqlLiteral } from './article.repository.js';
import type { ArticleRecord } from './article.repository.js';

export interface CreateEventInput {
  eventTitle: string;
  groupingKey?: string | null;
  eventSummary?: string | null;
  severity?: string | null;
  urgency?: string | null;
  confidence?: number | null;
  affectedVendors?: string[];
  affectedProducts?: string[];
  cves?: string[];
  attackTypes?: string[];
}

export interface EventRecord {
  id: string;
  groupingKey: string | null;
  firstSeenAt?: Date | null;
  eventTitle: string | null;
  eventSummary: string | null;
  eventStatus: string;
  publicationStatus: string;
  severity?: string | null;
  urgency?: string | null;
  confidence?: number | null;
  affectedVendors?: string[];
  affectedProducts?: string[];
  cves?: string[];
  attackTypes?: string[];
  summaryStale?: boolean;
}

interface EventRow {
  id: string;
  grouping_key: string | null;
  first_seen_at?: Date | null;
  event_title: string | null;
  event_summary: string | null;
  event_status: string;
  publication_status: string;
  severity?: string | null;
  urgency?: string | null;
  confidence?: string | null;
  affected_vendors?: string[];
  affected_products?: string[];
  cves?: string[];
  attack_types?: string[];
  summary_stale?: boolean;
}

interface EventArticleRow {
  id: string;
  feed_id: string | null;
  source_name: string | null;
  title: string | null;
  canonical_url: string | null;
  url_hash: string | null;
  title_hash: string | null;
  content_hash: string | null;
  rss_summary: string | null;
  rss_categories?: string[];
  clean_text: string | null;
  published_at: Date | null;
  extraction_status: string;
  extraction_method: string | null;
  extraction_error: string | null;
  processing_status: string;
}

export class EventRepository {
  constructor(private readonly db: Queryable) {}

  async createEvent(input: CreateEventInput): Promise<EventRecord> {
    const result = await this.db.query<EventRow>(
      `
        INSERT INTO cyber_events (
          grouping_key,
          event_title,
          event_summary,
          publication_status,
          severity,
          urgency,
          confidence,
          first_seen_at,
          last_seen_at,
          affected_vendors,
          affected_products,
          cves,
          attack_types
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), $8, $9, $10, $11)
        RETURNING id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale
      `,
      [
        input.groupingKey ?? null,
        input.eventTitle,
        input.eventSummary ?? null,
        'draft',
        input.severity ?? null,
        input.urgency ?? null,
        input.confidence ?? null,
        input.affectedVendors ?? [],
        input.affectedProducts ?? [],
        input.cves ?? [],
        input.attackTypes ?? [],
      ]
    );

    return mapEvent(result.rows[0]);
  }

  async findById(eventId: string): Promise<EventRecord | null> {
    const result = await this.db.query<EventRow>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale
        FROM cyber_events
        WHERE id = $1
      `,
      [eventId]
    );

    return result.rows[0] ? mapEvent(result.rows[0]) : null;
  }

  async findOpenByTitle(eventTitle: string): Promise<EventRecord | null> {
    const result = await this.db.query<EventRow>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale
        FROM cyber_events
        WHERE event_title = $1 AND event_status = 'open'
        LIMIT 1
      `,
      [eventTitle]
    );

    return result.rows[0] ? mapEvent(result.rows[0]) : null;
  }

  async findOpenByGroupingKey(groupingKey: string): Promise<EventRecord | null> {
    const result = await this.db.query<EventRow>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale
        FROM cyber_events
        WHERE grouping_key = $1 AND event_status = 'open'
        ORDER BY last_seen_at DESC NULLS LAST
        LIMIT 1
      `,
      [groupingKey]
    );

    return result.rows[0] ? mapEvent(result.rows[0]) : null;
  }

  async listEventsForArticle(articleId: string): Promise<EventRecord[]> {
    const result = await this.db.query<EventRow>(
      `
        SELECT e.id, e.grouping_key, e.first_seen_at, e.event_title, e.event_summary, e.event_status,
          e.publication_status, e.severity, e.urgency, e.confidence, e.affected_vendors, e.affected_products,
          e.cves, e.attack_types, e.summary_stale
        FROM cyber_events e
        JOIN event_articles ea ON ea.event_id = e.id
        WHERE ea.article_id = $1
      `,
      [articleId]
    );

    return result.rows.map(mapEvent);
  }

  async getSourceCount(eventId: string): Promise<number> {
    const result = await this.db.query<{ source_count: string | number }>(
      `SELECT source_count FROM cyber_events WHERE id = $1`,
      [eventId]
    );
    return result.rows[0] ? Number(result.rows[0].source_count) : 0;
  }

  async updateEventAssessment(
    eventId: string,
    assessment: { severity: string; urgency: string; confidence: number }
  ): Promise<void> {
    await this.db.query(
      `
        UPDATE cyber_events
        SET severity = $2,
          urgency = $3,
          confidence = $4,
          updated_at = now()
        WHERE id = $1
      `,
      [eventId, assessment.severity, assessment.urgency, assessment.confidence]
    );
  }

  async setPublicationStatus(
    eventId: string,
    publicationStatus: 'draft' | 'approved'
  ): Promise<EventRecord> {
    const result = await this.db.query<EventRow>(
      `
        UPDATE cyber_events
        SET publication_status = $2,
          updated_at = now()
        WHERE id = $1
        RETURNING id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale
      `,
      [eventId, publicationStatus]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Canonical event ${eventId} was not found`);
    }
    return mapEvent(row);
  }

  async updateEventFields(
    eventId: string,
    fields: {
      eventTitle: string;
      eventSummary: string | null;
      severity: string | null;
      urgency: string | null;
      affectedVendors: string[];
      affectedProducts: string[];
      cves: string[];
      attackTypes: string[];
    }
  ): Promise<EventRecord> {
    const result = await this.db.query<EventRow>(
      `
        UPDATE cyber_events
        SET event_title = $2,
          event_summary = $3,
          severity = $4,
          urgency = $5,
          affected_vendors = $6,
          affected_products = $7,
          cves = $8,
          attack_types = $9,
          updated_at = now()
        WHERE id = $1
        RETURNING id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale
      `,
      [
        eventId,
        fields.eventTitle,
        fields.eventSummary,
        fields.severity,
        fields.urgency,
        fields.affectedVendors,
        fields.affectedProducts,
        fields.cves,
        fields.attackTypes,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Canonical event ${eventId} was not found`);
    }
    return mapEvent(row);
  }

  async listForWorkspace(limit = 100): Promise<
    Array<EventRecord & { sourceCount: number; lastSeenAt: Date | null }>
  > {
    const result = await this.db.query<EventRow & { source_count: string | number; last_seen_at: Date | null }>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale,
          source_count, last_seen_at
        FROM cyber_events
        ORDER BY
          CASE publication_status WHEN 'draft' THEN 0 ELSE 1 END,
          last_seen_at DESC NULLS LAST,
          id DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows.map((row) => ({
      ...mapEvent(row),
      sourceCount: Number(row.source_count),
      lastSeenAt: row.last_seen_at ?? null,
    }));
  }

  async countForWorkspace(publicationStatus: 'draft' | 'approved'): Promise<number> {
    const result = await this.db.query<{ count: string | number }>(
      `
        SELECT COUNT(*)::text AS count
        FROM cyber_events
        WHERE publication_status = $1
      `,
      [publicationStatus]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listForWorkspacePage(
    publicationStatus: 'draft' | 'approved',
    limit = 25,
    offset = 0
  ): Promise<Array<EventRecord & { sourceCount: number; lastSeenAt: Date | null }>> {
    const result = await this.db.query<EventRow & { source_count: string | number; last_seen_at: Date | null }>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale,
          source_count, last_seen_at
        FROM cyber_events
        WHERE publication_status = $1
        ORDER BY last_seen_at DESC NULLS LAST, id DESC
        LIMIT $2 OFFSET $3
      `,
      [publicationStatus, limit, offset]
    );

    return result.rows.map((row) => ({
      ...mapEvent(row),
      sourceCount: Number(row.source_count),
      lastSeenAt: row.last_seen_at ?? null,
    }));
  }

  async listAlertCandidates(limit = 20): Promise<EventRecord[]> {
    const result = await this.db.query<EventRow>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale
        FROM cyber_events
        WHERE event_status = 'open'
          AND source_count > 0
        ORDER BY last_seen_at DESC NULLS LAST, id DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows.map(mapEvent);
  }

  async listEventsMissingEmbedding(limit = 20, maxRetries = 5): Promise<EventRecord[]> {
    const result = await this.db.query<EventRow>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale
        FROM cyber_events
        WHERE event_embedding IS NULL
          AND event_status = 'open'
          AND source_count > 0
          AND event_embedding_retry_count < $2
        ORDER BY last_seen_at DESC NULLS LAST, id ASC
        LIMIT $1
      `,
      [limit, maxRetries]
    );

    return result.rows.map(mapEvent);
  }

  async saveEventEmbedding(
    eventId: string,
    vector: number[],
    provenance: { model: string; dims: number } = {
      model: 'unknown',
      dims: vector.length,
    }
  ): Promise<void> {
    await this.db.query(
      `
        UPDATE cyber_events
        SET event_embedding = $2::vector,
          event_embedding_model = $3,
          event_embedding_dims = $4,
          event_embedded_at = now(),
          event_embedding_retry_count = 0,
          event_embedding_error = NULL,
          updated_at = now()
        WHERE id = $1
      `,
      [eventId, vectorToSqlLiteral(vector), provenance.model, provenance.dims]
    );
  }

  async recordEventEmbeddingFailure(eventId: string, message: string): Promise<void> {
    await this.db.query(
      `
        UPDATE cyber_events
        SET event_embedding_retry_count = event_embedding_retry_count + 1,
          event_embedding_error = $2,
          updated_at = now()
        WHERE id = $1
      `,
      [eventId, message]
    );
  }

  async saveLlmSummary(eventId: string, summary: unknown): Promise<void> {
    await this.db.query(
      `
        UPDATE cyber_events
        SET llm_summary = $2::jsonb,
          event_title = COALESCE(($2::jsonb ->> 'title'), event_title),
          event_summary = COALESCE(($2::jsonb ->> 'summary'), event_summary),
          severity = COALESCE(($2::jsonb ->> 'severity'), severity),
          urgency = COALESCE(($2::jsonb ->> 'urgency'), urgency),
          confidence = COALESCE(($2::jsonb ->> 'confidence')::numeric, confidence),
          summary_stale = false,
          updated_at = now()
        WHERE id = $1
      `,
      [eventId, JSON.stringify(summary)]
    );
  }

  async markSummaryStale(eventId: string): Promise<void> {
    await this.db.query(
      `
        UPDATE cyber_events
        SET summary_stale = true,
          updated_at = now()
        WHERE id = $1
      `,
      [eventId]
    );
  }

  async listEventsNeedingSummary(limit = 20): Promise<EventRecord[]> {
    const result = await this.db.query<EventRow>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale
        FROM cyber_events
        WHERE event_status = 'open'
          AND source_count > 0
          AND (llm_summary IS NULL OR summary_stale)
        ORDER BY last_seen_at DESC NULLS LAST, id DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows.map(mapEvent);
  }

  async listArticlesForEvent(eventId: string): Promise<ArticleRecord[]> {
    const result = await this.db.query<EventArticleRow>(
      `
        SELECT a.id, a.feed_id, a.source_name, a.title, a.canonical_url, a.url_hash, a.title_hash, a.content_hash,
          a.rss_summary, a.rss_categories, a.clean_text, a.published_at, a.extraction_status, a.extraction_method,
          a.extraction_error, a.processing_status
        FROM event_articles ea
        JOIN articles a ON a.id = ea.article_id
        WHERE ea.event_id = $1
        ORDER BY a.published_at ASC NULLS LAST, a.fetched_at ASC, a.id ASC
      `,
      [eventId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      feedId: row.feed_id,
      sourceName: row.source_name,
      title: row.title,
      canonicalUrl: row.canonical_url,
      urlHash: row.url_hash,
      titleHash: row.title_hash,
      contentHash: row.content_hash,
      rssSummary: row.rss_summary,
      rssCategories: row.rss_categories ?? [],
      cleanText: row.clean_text,
      publishedAt: row.published_at,
      extractionStatus: row.extraction_status,
      extractionMethod: row.extraction_method,
      extractionError: row.extraction_error,
      processingStatus: row.processing_status,
    }));
  }

  async findSimilarEvents(
    vector: number[],
    options: {
      limit?: number;
      daysBack?: number;
      excludeEventId?: string;
      model?: string;
      dims?: number;
    } = {}
  ): Promise<Array<EventRecord & { distance: number }>> {
    const result = await this.db.query<EventRow & { distance: string }>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, publication_status,
          severity, urgency, confidence, affected_vendors, affected_products, cves, attack_types, summary_stale,
          event_embedding <=> $1::vector AS distance
        FROM cyber_events
        WHERE event_embedding IS NOT NULL
          AND event_embedding_model IS NOT NULL
          AND event_embedding_model = $5
          AND event_embedding_dims = $6
          AND last_seen_at > now() - make_interval(days => $2)
          AND ($3::BIGINT IS NULL OR id <> $3)
        ORDER BY event_embedding <=> $1::vector
        LIMIT $4
      `,
      [
        vectorToSqlLiteral(vector),
        options.daysBack ?? 30,
        options.excludeEventId ?? null,
        options.limit ?? 10,
        options.model ?? 'unknown',
        options.dims ?? 0,
      ]
    );

    return result.rows.map((row) => ({
      ...mapEvent(row),
      distance: Number(row.distance),
    }));
  }

  async attachArticle(input: {
    eventId: string;
    articleId: string;
    relationship: string;
    confidence?: number | null;
    isPrimarySource?: boolean;
    isMaterialUpdate?: boolean;
  }): Promise<void> {
    await this.db.query(
      `
        INSERT INTO event_articles (
          event_id,
          article_id,
          relationship,
          confidence,
          is_primary_source,
          is_material_update
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (event_id, article_id)
        DO UPDATE SET
          relationship = EXCLUDED.relationship,
          confidence = EXCLUDED.confidence,
          is_material_update = EXCLUDED.is_material_update
      `,
      [
        input.eventId,
        input.articleId,
        input.relationship,
        input.confidence ?? null,
        input.isPrimarySource ?? false,
        input.isMaterialUpdate ?? false,
      ]
    );

    await this.db.query(
      `
        UPDATE cyber_events
        SET source_count = (
          SELECT count(*) FROM event_articles WHERE event_id = $1
        ),
          last_seen_at = now(),
          updated_at = now(),
          summary_stale = CASE WHEN $2 = 'same_event_material_update' THEN true ELSE summary_stale END
        WHERE id = $1
      `,
      [input.eventId, input.relationship]
    );
  }

  async detachArticle(eventId: string, articleId: string): Promise<void> {
    const result = await this.db.query<{ id: string }>(
      `
        DELETE FROM event_articles
        WHERE event_id = $1 AND article_id = $2
        RETURNING id
      `,
      [eventId, articleId]
    );
    if ((result.rowCount ?? result.rows.length) === 0) {
      throw new Error(`Article ${articleId} is not attached to event ${eventId}`);
    }

    await this.db.query(
      `
        UPDATE cyber_events
        SET source_count = (
          SELECT count(*) FROM event_articles WHERE event_id = $1
        ),
          updated_at = now()
        WHERE id = $1
      `,
      [eventId]
    );
  }

  private mapTriageArticle(row: EventArticleRow): ArticleRecord {
    return {
      id: row.id,
      feedId: row.feed_id,
      sourceName: row.source_name,
      title: row.title,
      canonicalUrl: row.canonical_url,
      urlHash: row.url_hash,
      titleHash: row.title_hash,
      contentHash: row.content_hash,
      rssSummary: row.rss_summary,
      rssCategories: row.rss_categories ?? [],
      cleanText: row.clean_text,
      publishedAt: row.published_at,
      extractionStatus: row.extraction_status,
      extractionMethod: row.extraction_method,
      extractionError: row.extraction_error,
      processingStatus: row.processing_status,
    };
  }

  private static readonly TRIAGE_WHERE = `
    NOT EXISTS (
      SELECT 1
      FROM event_articles ea
      JOIN cyber_events e ON e.id = ea.event_id
      WHERE ea.article_id = a.id
        AND e.publication_status = 'approved'
    )
  `;

  async countArticlesNeedingTriage(): Promise<number> {
    const result = await this.db.query<{ count: string | number }>(
      `
        SELECT COUNT(*)::text AS count
        FROM articles a
        WHERE ${EventRepository.TRIAGE_WHERE}
      `
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listArticlesNeedingTriage(limit = 50, offset = 0): Promise<ArticleRecord[]> {
    const result = await this.db.query<EventArticleRow>(
      `
        SELECT a.id, a.feed_id, a.source_name, a.title, a.canonical_url, a.url_hash, a.title_hash, a.content_hash,
          a.rss_summary, a.rss_categories, a.clean_text, a.published_at, a.extraction_status, a.extraction_method,
          a.extraction_error, a.processing_status
        FROM articles a
        WHERE ${EventRepository.TRIAGE_WHERE}
        ORDER BY a.published_at DESC NULLS LAST, a.id DESC
        LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    return result.rows.map((row) => this.mapTriageArticle(row));
  }
}

function mapEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    groupingKey: row.grouping_key ?? null,
    firstSeenAt: row.first_seen_at ?? null,
    eventTitle: row.event_title,
    eventSummary: row.event_summary,
    eventStatus: row.event_status,
    publicationStatus: row.publication_status,
    severity: row.severity ?? null,
    urgency: row.urgency ?? null,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    affectedVendors: row.affected_vendors ?? [],
    affectedProducts: row.affected_products ?? [],
    cves: row.cves ?? [],
    attackTypes: row.attack_types ?? [],
    summaryStale: row.summary_stale ?? false,
  };
}
