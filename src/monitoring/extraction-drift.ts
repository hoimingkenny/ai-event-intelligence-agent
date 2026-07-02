import type { Queryable } from '../db/repositories/types.js';
import { logWarn } from '../utils/logger.js';

/**
 * Per-source extraction drift detection.
 *
 * Uses the free ground-truth metric written at extraction time (rss_recall:
 * word recall of the RSS summary against extracted cleanText) plus
 * content_quality_score and failure rate over a rolling window of the most
 * recent articles per source.
 *
 * A site redesign that breaks a source selector shows up as a sharp drop in
 * median recall — that is the trigger for re-learning extraction rules, so
 * rules only need attention when they actually break.
 */

export interface DriftThresholds {
  /** Most recent N extracted articles per source. */
  windowSize: number;
  /** Below this many samples, don't judge (avoid noise on quiet feeds). */
  minSample: number;
  minMedianRecall: number;
  minMedianQuality: number;
  maxFailureRate: number;
}

export const DEFAULT_DRIFT_THRESHOLDS: DriftThresholds = {
  windowSize: 20,
  minSample: 5,
  minMedianRecall: 0.6,
  minMedianQuality: 0.3,
  maxFailureRate: 0.5,
};

export interface SourceDriftReport {
  sourceName: string;
  sampled: number;
  recallSamples: number;
  medianRecall: number | null;
  medianQuality: number | null;
  failureRate: number;
  drifted: boolean;
  reasons: string[];
}

export interface DriftCheckResult {
  checkedAt: string;
  sources: SourceDriftReport[];
  driftedSources: string[];
}

interface SampleRow {
  source_name: string;
  rss_recall: string | number | null;
  content_quality_score: string | number | null;
  extraction_status: string;
}

export async function checkExtractionDrift(
  db: Queryable,
  options: Partial<DriftThresholds> = {}
): Promise<DriftCheckResult> {
  const thresholds = { ...DEFAULT_DRIFT_THRESHOLDS, ...options };
  const result = await db.query<SampleRow>(
    `
      SELECT source_name, rss_recall, content_quality_score, extraction_status
      FROM (
        SELECT source_name, rss_recall, content_quality_score, extraction_status,
          row_number() OVER (PARTITION BY source_name ORDER BY extracted_at DESC) AS rn
        FROM articles
        WHERE extracted_at IS NOT NULL
          AND source_name IS NOT NULL
      ) recent
      WHERE rn <= $1
    `,
    [thresholds.windowSize]
  );

  const bySource = new Map<string, SampleRow[]>();
  for (const row of result.rows) {
    const rows = bySource.get(row.source_name) ?? [];
    rows.push(row);
    bySource.set(row.source_name, rows);
  }

  const sources = Array.from(bySource.entries())
    .map(([sourceName, rows]) => evaluateSource(sourceName, rows, thresholds))
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  const driftedSources = sources.filter((source) => source.drifted).map((source) => source.sourceName);

  for (const source of sources) {
    if (source.drifted) {
      logWarn(
        {
          source: source.sourceName,
          medianRecall: source.medianRecall,
          medianQuality: source.medianQuality,
          failureRate: source.failureRate,
          reasons: source.reasons,
        },
        'extraction_drift_detected'
      );
    }
  }

  return { checkedAt: new Date().toISOString(), sources, driftedSources };
}

function evaluateSource(
  sourceName: string,
  rows: SampleRow[],
  thresholds: DriftThresholds
): SourceDriftReport {
  const recalls = numbers(rows.map((row) => row.rss_recall));
  const qualities = numbers(rows.map((row) => row.content_quality_score));
  const failures = rows.filter((row) => /failed/i.test(row.extraction_status)).length;
  const failureRate = rows.length === 0 ? 0 : failures / rows.length;
  const medianRecall = median(recalls);
  const medianQuality = median(qualities);

  const reasons: string[] = [];
  if (rows.length >= thresholds.minSample) {
    if (medianRecall !== null && medianRecall < thresholds.minMedianRecall) {
      reasons.push(`median_recall_${medianRecall.toFixed(2)}_below_${thresholds.minMedianRecall}`);
    }
    if (medianQuality !== null && medianQuality < thresholds.minMedianQuality) {
      reasons.push(`median_quality_${medianQuality.toFixed(2)}_below_${thresholds.minMedianQuality}`);
    }
    if (failureRate > thresholds.maxFailureRate) {
      reasons.push(`failure_rate_${failureRate.toFixed(2)}_above_${thresholds.maxFailureRate}`);
    }
  }

  return {
    sourceName,
    sampled: rows.length,
    recallSamples: recalls.length,
    medianRecall,
    medianQuality,
    failureRate,
    drifted: reasons.length > 0,
    reasons,
  };
}

function numbers(values: Array<string | number | null>): number[] {
  return values
    .map((value) => (value === null ? NaN : Number(value)))
    .filter((value) => Number.isFinite(value));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
