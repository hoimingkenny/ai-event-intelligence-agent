import { env } from '../config/env.js';
import type { EventRecord } from '../db/repositories/event.repository.js';

/**
 * Two-tier alert policy.
 *
 * `early_warning`: speed over confirmation. A fresh event touching a monitored
 * vendor alerts immediately, explicitly labeled unconfirmed — low-confidence
 * early signals are surfaced, never silently suppressed.
 *
 * `confirmed`: the strict gate (severity, urgency, confidence). An event that
 * already fired an early warning is upgraded when it crosses this gate.
 *
 * Material updates always bypass the recent-alert suppression window
 * (guardrail: never suppress same-event material updates).
 */

export type AlertTier = 'early_warning' | 'confirmed';

export interface RecentAlert {
  tier: AlertTier | null;
  createdAt: Date;
}

export interface AlertDecision {
  shouldAlert: boolean;
  suppressed: boolean;
  reason: string;
  tier: AlertTier | null;
}

const CONFIRMED_SEVERITIES = new Set(['medium', 'high', 'critical']);
const CONFIRMED_URGENCIES = new Set(['P1', 'P2']);

export function decideAlert(
  event: EventRecord,
  options: {
    recentAlert?: RecentAlert | null;
    hasNewMaterialUpdate?: boolean;
    minConfidence?: number;
    earlyWindowHours?: number;
    now?: Date;
  } = {}
): AlertDecision {
  const now = options.now ?? new Date();
  const minConfidence = options.minConfidence ?? env.minAlertConfidence;
  const earlyWindowHours = options.earlyWindowHours ?? env.earlyWarningWindowHours;

  if (!event.affectedVendors || event.affectedVendors.length === 0) {
    return { shouldAlert: false, suppressed: true, reason: 'no_affected_vendor', tier: null };
  }

  const confidence = event.confidence ?? 0;
  const confirmedEligible =
    !!event.severity &&
    CONFIRMED_SEVERITIES.has(event.severity) &&
    !!event.urgency &&
    CONFIRMED_URGENCIES.has(event.urgency) &&
    confidence >= minConfidence;

  const ageHours = event.firstSeenAt
    ? (now.getTime() - event.firstSeenAt.getTime()) / 3_600_000
    : null;
  // Unknown age is treated as fresh: better a labeled early signal than silence.
  const earlyEligible = ageHours === null || ageHours <= earlyWindowHours;

  if (options.recentAlert) {
    if (options.hasNewMaterialUpdate) {
      return {
        shouldAlert: true,
        suppressed: false,
        reason: 'material_update_bypasses_suppression',
        tier: confirmedEligible ? 'confirmed' : 'early_warning',
      };
    }
    if (confirmedEligible && options.recentAlert.tier === 'early_warning') {
      return { shouldAlert: true, suppressed: false, reason: 'upgraded_to_confirmed', tier: 'confirmed' };
    }
    return { shouldAlert: false, suppressed: true, reason: 'recent_alert_suppression', tier: null };
  }

  if (confirmedEligible) {
    return { shouldAlert: true, suppressed: false, reason: 'confirmed_vendor_impact_event', tier: 'confirmed' };
  }

  if (earlyEligible) {
    return {
      shouldAlert: true,
      suppressed: false,
      reason: 'early_warning_unconfirmed_signal',
      tier: 'early_warning',
    };
  }

  return {
    shouldAlert: false,
    suppressed: true,
    reason: 'stale_event_below_confirmed_gate',
    tier: null,
  };
}
