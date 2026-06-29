import type { Queryable } from './types.js';

export interface CreateAlertInput {
  eventId: string;
  alertStatus: string;
  alertChannel?: string | null;
  alertReason?: string | null;
  severity?: string | null;
  urgency?: string | null;
  suppressed?: boolean;
  suppressionReason?: string | null;
}

export class AlertRepository {
  constructor(private readonly db: Queryable) {}

  async createAlert(input: CreateAlertInput): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `
        INSERT INTO alerts (
          event_id,
          alert_status,
          alert_channel,
          alert_reason,
          severity,
          urgency,
          suppressed,
          suppression_reason,
          sent_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $7 = false THEN now() ELSE NULL END)
        RETURNING id
      `,
      [
        input.eventId,
        input.alertStatus,
        input.alertChannel ?? null,
        input.alertReason ?? null,
        input.severity ?? null,
        input.urgency ?? null,
        input.suppressed ?? false,
        input.suppressionReason ?? null,
      ]
    );

    return result.rows[0].id;
  }

  async hasRecentAlert(eventId: string, suppressionHours: number): Promise<boolean> {
    const result = await this.db.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM alerts
          WHERE event_id = $1
            AND suppressed = false
            AND created_at > now() - make_interval(hours => $2)
        ) AS exists
      `,
      [eventId, suppressionHours]
    );

    return result.rows[0].exists;
  }
}
