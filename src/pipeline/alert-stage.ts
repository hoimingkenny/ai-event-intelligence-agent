import { env } from '../config/env.js';
import { AlertRepository } from '../db/repositories/alert.repository.js';
import { EventRepository } from '../db/repositories/event.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { decideAlert } from '../alerts/alert-decision.js';

export interface AlertStageResult {
  reviewed: number;
  sent: number;
  suppressed: number;
  earlyWarnings: number;
  confirmed: number;
  upgrades: number;
  materialUpdateBypasses: number;
}

export async function runAlertStage(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<AlertStageResult> {
  const events = new EventRepository(db);
  const alerts = new AlertRepository(db);
  const candidates = await events.listAlertCandidates(options.limit ?? 20);
  const result: AlertStageResult = {
    reviewed: candidates.length,
    sent: 0,
    suppressed: 0,
    earlyWarnings: 0,
    confirmed: 0,
    upgrades: 0,
    materialUpdateBypasses: 0,
  };

  for (const event of candidates) {
    const recentAlert = await alerts.getRecentAlert(event.id, env.alertSuppressionHours);
    const hasNewMaterialUpdate = recentAlert
      ? await alerts.hasMaterialUpdateSince(event.id, recentAlert.createdAt)
      : false;
    const decision = decideAlert(event, { recentAlert, hasNewMaterialUpdate });

    await alerts.createAlert({
      eventId: event.id,
      alertStatus: decision.shouldAlert ? 'sent' : 'suppressed',
      alertTier: decision.tier,
      alertChannel: 'database',
      alertReason: decision.reason,
      severity: event.severity,
      urgency: event.urgency,
      suppressed: decision.suppressed,
      suppressionReason: decision.suppressed ? decision.reason : null,
    });

    if (decision.shouldAlert) {
      result.sent += 1;
      if (decision.tier === 'early_warning') result.earlyWarnings += 1;
      if (decision.tier === 'confirmed') result.confirmed += 1;
      if (decision.reason === 'upgraded_to_confirmed') result.upgrades += 1;
      if (decision.reason === 'material_update_bypasses_suppression') result.materialUpdateBypasses += 1;
    } else {
      result.suppressed += 1;
    }
  }

  return result;
}
