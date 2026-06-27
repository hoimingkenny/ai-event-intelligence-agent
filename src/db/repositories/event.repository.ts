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
}

interface EventRow {
  id: string;
  event_title: string | null;
  event_summary: string | null;
  event_status: string;
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
      'SELECT id, event_title, event_summary, event_status FROM cyber_events WHERE id = $1',
      [eventId]
    );

    return result.rows[0] ? mapEvent(result.rows[0]) : null;
  }
}

function mapEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    eventTitle: row.event_title,
    eventSummary: row.event_summary,
    eventStatus: row.event_status,
  };
}
