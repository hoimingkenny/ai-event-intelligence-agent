import type { Queryable } from './types.js';

export interface CreateEventInput {
  eventTitle: string;
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
  eventTitle: string | null;
  eventSummary: string | null;
  eventStatus: string;
  severity?: string | null;
  urgency?: string | null;
  confidence?: number | null;
  affectedVendors?: string[];
}

interface EventRow {
  id: string;
  event_title: string | null;
  event_summary: string | null;
  event_status: string;
  severity?: string | null;
  urgency?: string | null;
  confidence?: string | null;
  affected_vendors?: string[];
}

export class EventRepository {
  constructor(private readonly db: Queryable) {}

  async createEvent(input: CreateEventInput): Promise<EventRecord> {
    const result = await this.db.query<EventRow>(
      `
        INSERT INTO cyber_events (
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
        VALUES ($1, $2, $3, $4, $5, now(), now(), $6, $7, $8, $9)
        RETURNING id, event_title, event_summary, event_status
      `,
      [
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
      'SELECT id, event_title, event_summary, event_status, severity, urgency, confidence, affected_vendors FROM cyber_events WHERE id = $1',
      [eventId]
    );

    return result.rows[0] ? mapEvent(result.rows[0]) : null;
  }

  async findOpenByTitle(eventTitle: string): Promise<EventRecord | null> {
    const result = await this.db.query<EventRow>(
      `
        SELECT id, event_title, event_summary, event_status, severity, urgency, confidence, affected_vendors
        FROM cyber_events
        WHERE event_title = $1 AND event_status = 'open'
        LIMIT 1
      `,
      [eventTitle]
    );

    return result.rows[0] ? mapEvent(result.rows[0]) : null;
  }

  async listAlertCandidates(limit = 20): Promise<EventRecord[]> {
    const result = await this.db.query<EventRow>(
      `
        SELECT id, event_title, event_summary, event_status, severity, urgency, confidence, affected_vendors
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
    eventTitle: row.event_title,
    eventSummary: row.event_summary,
    eventStatus: row.event_status,
    severity: row.severity ?? null,
    urgency: row.urgency ?? null,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    affectedVendors: row.affected_vendors ?? [],
  };
}
