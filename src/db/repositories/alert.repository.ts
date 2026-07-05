import type { Queryable } from './types.js';

export type AlertTierValue = 'early_warning' | 'confirmed';

export interface CreateAlertInput {
  eventId: string;
  alertStatus: string;
  alertTier?: AlertTierValue | null;
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
          alert_tier,
          alert_channel,
          alert_reason,
          severity,
          urgency,
          suppressed,
          suppression_reason,
          sent_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $8 = false THEN now() ELSE NULL END)
        RETURNING id
      `,
      [
        input.eventId,
        input.alertStatus,
        input.alertTier ?? null,
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

  /** Most recent non-suppressed alert inside the suppression window, if any. */
  async getRecentAlert(
    eventId: string,
    suppressionHours: number
  ): Promise<{ tier: AlertTierValue | null; createdAt: Date } | null> {
    const result = await this.db.query<{ alert_tier: AlertTierValue | null; created_at: Date }>(
      `
        SELECT alert_tier, created_at
        FROM alerts
        WHERE event_id = $1
          AND suppressed = false
          AND created_at > now() - make_interval(hours => $2)
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [eventId, suppressionHours]
    );

    const row = result.rows[0];
    return row ? { tier: row.alert_tier ?? null, createdAt: row.created_at } : null;
  }

  /** Guardrail input: has a material update been attached since the last alert? */
  async hasMaterialUpdateSince(eventId: string, since: Date): Promise<boolean> {
    const result = await this.db.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM event_articles
          WHERE event_id = $1
            AND is_material_update = true
            AND created_at > $2
        ) AS exists
      `,
      [eventId, since]
    );

    return result.rows[0].exists;
  }
}
