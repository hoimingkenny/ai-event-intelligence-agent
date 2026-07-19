/** CVSS v3 qualitative bands, folded to Critical / High / Medium for triage display. */
export type CvssTriageGrade = 'critical' | 'high' | 'medium';

export function cvssTriageGrade(score: number): CvssTriageGrade {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  return 'medium';
}

const CVSS_GRADE_RANK: Record<CvssTriageGrade, number> = {
  medium: 1,
  high: 2,
  critical: 3,
};

/** Most severe grade among scores; null when none are present. */
export function worstCvssTriageGrade(scores: Array<number | null | undefined>): CvssTriageGrade | null {
  let worst: CvssTriageGrade | null = null;
  for (const score of scores) {
    if (score == null || !Number.isFinite(score)) continue;
    const grade = cvssTriageGrade(score);
    if (!worst || CVSS_GRADE_RANK[grade] > CVSS_GRADE_RANK[worst]) worst = grade;
  }
  return worst;
}

/**
 * EPSS triage thresholds (probability 0–1, percentile 0–1).
 * Red (critical): score ≥ 0.10 or percentile ≥ 0.95
 * Amber (high): score ≥ 0.05 or percentile ≥ 0.90
 */
export type EpssTriageGrade = 'critical' | 'high';

export const EPSS_CRITICAL_SCORE = 0.1;
export const EPSS_HIGH_SCORE = 0.05;
export const EPSS_CRITICAL_PERCENTILE = 0.95;
export const EPSS_HIGH_PERCENTILE = 0.9;

export function epssTriageGrade(
  score: number | null | undefined,
  percentile: number | null | undefined
): EpssTriageGrade | null {
  const scoreHit =
    typeof score === 'number' && Number.isFinite(score)
      ? score >= EPSS_CRITICAL_SCORE
        ? 'critical'
        : score >= EPSS_HIGH_SCORE
          ? 'high'
          : null
      : null;
  const pctHit =
    typeof percentile === 'number' && Number.isFinite(percentile)
      ? percentile >= EPSS_CRITICAL_PERCENTILE
        ? 'critical'
        : percentile >= EPSS_HIGH_PERCENTILE
          ? 'high'
          : null
      : null;
  if (scoreHit === 'critical' || pctHit === 'critical') return 'critical';
  if (scoreHit === 'high' || pctHit === 'high') return 'high';
  return null;
}

export function worstEpssTriageGrade(
  rows: Array<{ score: number | null | undefined; percentile: number | null | undefined }>
): EpssTriageGrade | null {
  let worst: EpssTriageGrade | null = null;
  for (const row of rows) {
    const grade = epssTriageGrade(row.score, row.percentile);
    if (!grade) continue;
    if (!worst || (grade === 'critical' && worst === 'high')) worst = grade;
    else if (!worst) worst = grade;
  }
  return worst;
}
