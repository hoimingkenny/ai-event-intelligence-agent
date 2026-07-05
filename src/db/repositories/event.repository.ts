import type { Queryable } from './types.js';
import { vectorToSqlLiteral } from './article.repository.js';

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
  severity?: string | null;
  urgency?: string | null;
  confidence?: number | null;
  affectedVendors?: string[];
  affectedProducts?: string[];
  cves?: string[];
  attackTypes?: string[];
}

interface EventRow {
  id: string;
  grouping_key: string | null;
  first_seen_at?: Date | null;
  event_title: string | null;
  event_summary: string | null;
  event_status: string;
  severity?: string | null;
  urgency?: string | null;
  confidence?: string | null;
  affected_vendors?: string[];
  affected_products?: string[];
  cves?: string[];
  attack_types?: string[];
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
        VALUES ($1, $2, $3, $4, $5, $6, now(), now(), $7, $8, $9, $10)
        RETURNING id, grouping_key, first_seen_at, event_title, event_summary, event_status, severity, urgency, confidence,
          affected_vendors, affected_products, cves, attack_types
      `,
      [
        input.groupingKey ?? null,
        input.eventTitle,
        input.eventSummary ?? null,
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
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, severity, urgency, confidence,
          affected_vendors, affected_products, cves, attack_types
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
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, severity, urgency, confidence,
          affected_vendors, affected_products, cves, attack_types
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
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, severity, urgency, confidence,
          affected_vendors, affected_products, cves, attack_types
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
        SELECT e.id, e.grouping_key, e.first_seen_at, e.event_title, e.event_summary, e.event_status, e.severity,
          e.urgency, e.confidence, e.affected_vendors, e.affected_products, e.cves, e.attack_types
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

  async listAlertCandidates(limit = 20): Promise<EventRecord[]> {
    const result = await this.db.query<EventRow>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, severity, urgency, confidence,
          affected_vendors, affected_products, cves, attack_types
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

  async listEventsMissingEmbedding(limit = 20): Promise<EventRecord[]> {
    const result = await this.db.query<EventRow>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, severity, urgency, confidence,
          affected_vendors, affected_products, cves, attack_types
        FROM cyber_events
        WHERE event_embedding IS NULL
          AND event_status = 'open'
          AND source_count > 0
        ORDER BY last_seen_at DESC NULLS LAST, id ASC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows.map(mapEvent);
  }

  async saveEventEmbedding(eventId: string, vector: number[]): Promise<void> {
    await this.db.query(
      `
        UPDATE cyber_events
        SET event_embedding = $2::vector,
          updated_at = now()
        WHERE id = $1
      `,
      [eventId, vectorToSqlLiteral(vector)]
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
          updated_at = now()
        WHERE id = $1
      `,
      [eventId, JSON.stringify(summary)]
    );
  }

  async findSimilarEvents(
    vector: number[],
    options: { limit?: number; daysBack?: number; excludeEventId?: string } = {}
  ): Promise<Array<EventRecord & { distance: number }>> {
    const result = await this.db.query<EventRow & { distance: string }>(
      `
        SELECT id, grouping_key, first_seen_at, event_title, event_summary, event_status, severity, urgency, confidence,
          affected_vendors, affected_products, cves, attack_types,
          event_embedding <=> $1::vector AS distance
        FROM cyber_events
        WHERE event_embedding IS NOT NULL
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
          updated_at = now()
        WHERE id = $1
      `,
      [input.eventId]
    );
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
    severity: row.severity ?? null,
    urgency: row.urgency ?? null,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    affectedVendors: row.affected_vendors ?? [],
    affectedProducts: row.affected_products ?? [],
    cves: row.cves ?? [],
    attackTypes: row.attack_types ?? [],
  };
}
