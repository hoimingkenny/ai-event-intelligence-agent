import { env } from '../config/env.js';
import type { EventRecord } from '../db/repositories/event.repository.js';

export interface AlertDecision {
  shouldAlert: boolean;
  suppressed: boolean;
  reason: string;
}

const ALERT_SEVERITIES = new Set(['medium', 'high', 'critical']);
const ALERT_URGENCIES = new Set(['P1', 'P2']);

export function decideAlert(
  event: EventRecord,
  options: { hasRecentAlert?: boolean; minConfidence?: number } = {}
): AlertDecision {
  const confidence = event.confidence ?? 0;
  const minConfidence = options.minConfidence ?? env.minAlertConfidence;

  if (options.hasRecentAlert) {
    return { shouldAlert: false, suppressed: true, reason: 'recent_alert_suppression' };
  }
  if (!event.affectedVendors || event.affectedVendors.length === 0) {
    return { shouldAlert: false, suppressed: true, reason: 'no_affected_vendor' };
  }
  if (!event.severity || !ALERT_SEVERITIES.has(event.severity)) {
    return { shouldAlert: false, suppressed: true, reason: 'severity_below_threshold' };
  }
  if (!event.urgency || !ALERT_URGENCIES.has(event.urgency)) {
    return { shouldAlert: false, suppressed: true, reason: 'urgency_below_threshold' };
  }
  if (confidence < minConfidence) {
    return { shouldAlert: false, suppressed: true, reason: 'confidence_below_threshold' };
  }

  return { shouldAlert: true, suppressed: false, reason: 'new_vendor_impact_event' };
}
