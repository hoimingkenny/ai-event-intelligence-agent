import { env } from '../config/env.js';
import { AlertRepository } from '../db/repositories/alert.repository.js';
import { EventRepository } from '../db/repositories/event.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { decideAlert } from '../alerts/alert-decision.js';

export interface AlertStageResult {
  reviewed: number;
  sent: number;
  suppressed: number;
}

export async function runAlertStage(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<AlertStageResult> {
  const events = new EventRepository(db);
  const alerts = new AlertRepository(db);
  const candidates = await events.listAlertCandidates(options.limit ?? 20);
  let sent = 0;
  let suppressed = 0;

  for (const event of candidates) {
    const hasRecentAlert = await alerts.hasRecentAlert(event.id, env.alertSuppressionHours);
    const decision = decideAlert(event, { hasRecentAlert });
    await alerts.createAlert({
      eventId: event.id,
      alertStatus: decision.shouldAlert ? 'sent' : 'suppressed',
      alertChannel: 'database',
      alertReason: decision.reason,
      severity: event.severity,
      urgency: event.urgency,
      suppressed: decision.suppressed,
      suppressionReason: decision.suppressed ? decision.reason : null,
    });

    if (decision.shouldAlert) sent += 1;
    else suppressed += 1;
  }

  return {
    reviewed: candidates.length,
    sent,
    suppressed,
  };
}
