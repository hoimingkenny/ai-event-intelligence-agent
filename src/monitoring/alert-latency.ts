import { env } from '../config/env.js';
import type { Queryable } from '../db/repositories/types.js';
import { logWarn } from '../utils/logger.js';

/**
 * Time-to-alert monitoring — the product metric for an early-warning system.
 *
 * Latency per sent alert = alert.created_at − earliest published_at among the
 * event's articles. Approximation caveat: published_at is the publisher's
 * timestamp, so this measures "publication → alert", which includes feed
 * polling delay — exactly the end-to-end number that matters for the 2-hour
 * impact-review window.
 */

export interface AlertLatencyThresholds {
  /** SLO for p90 publication → alert, in hours. */
  sloHours: number;
  /** Only alerts from the last N days are considered. */
  daysBack: number;
  /** Below this many samples, don't judge. */
  minSample: number;
}

export const DEFAULT_LATENCY_THRESHOLDS: AlertLatencyThresholds = {
  sloHours: 2,
  daysBack: 7,
  minSample: 3,
};

export interface AlertLatencyReport {
  checkedAt: string;
  sampled: number;
  p50Hours: number | null;
  p90Hours: number | null;
  maxHours: number | null;
  sloHours: number;
  breaches: number;
  sloViolated: boolean;
}

interface LatencyRow {
  alert_id: string;
  latency_seconds: string | number;
}

export async function checkAlertLatency(
  db: Queryable,
  options: Partial<AlertLatencyThresholds> = {}
): Promise<AlertLatencyReport> {
  const thresholds = {
    ...DEFAULT_LATENCY_THRESHOLDS,
    sloHours: options.sloHours ?? env.alertLatencySloHours,
    ...(options.daysBack !== undefined ? { daysBack: options.daysBack } : {}),
    ...(options.minSample !== undefined ? { minSample: options.minSample } : {}),
  };

  const result = await db.query<LatencyRow>(
    `
      SELECT a.id AS alert_id,
        EXTRACT(EPOCH FROM (a.created_at - min(ar.published_at))) AS latency_seconds
      FROM alerts a
      JOIN event_articles ea ON ea.event_id = a.event_id
      JOIN articles ar ON ar.id = ea.article_id
      WHERE a.suppressed = false
        AND a.created_at > now() - make_interval(days => $1)
        AND ar.published_at IS NOT NULL
      GROUP BY a.id, a.created_at
    `,
    [thresholds.daysBack]
  );

  const latenciesHours = result.rows
    .map((row) => Number(row.latency_seconds) / 3600)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);

  const report: AlertLatencyReport = {
    checkedAt: new Date().toISOString(),
    sampled: latenciesHours.length,
    p50Hours: percentile(latenciesHours, 0.5),
    p90Hours: percentile(latenciesHours, 0.9),
    maxHours: latenciesHours.length > 0 ? latenciesHours[latenciesHours.length - 1] : null,
    sloHours: thresholds.sloHours,
    breaches: latenciesHours.filter((value) => value > thresholds.sloHours).length,
    sloViolated: false,
  };

  report.sloViolated =
    report.sampled >= thresholds.minSample &&
    report.p90Hours !== null &&
    report.p90Hours > thresholds.sloHours;

  if (report.sloViolated) {
    logWarn(
      { p50Hours: report.p50Hours, p90Hours: report.p90Hours, sloHours: report.sloHours },
      'alert_latency_slo_violated'
    );
  }

  return report;
}

export function percentile(sortedAscending: number[], fraction: number): number | null {
  if (sortedAscending.length === 0) return null;
  const index = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.ceil(fraction * sortedAscending.length) - 1)
  );
  return sortedAscending[index];
}
