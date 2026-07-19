import type { CveSourceName, CveSourceStatus } from '../db/repositories/cve-case.repository.js';

/**
 * Normalized values persisted into cve_source_observations.normalized_value (JSONB).
 * The schema is source-discriminated: see ADR 0008 and the per-source adapters below.
 */
export interface NvdNormalized {
  description: string | null;
  cvssV3: { base: number; vector: string } | null;
  cvssV2: { base: number; vector: string } | null;
  publishedAt: string | null;
  lastModifiedAt: string | null;
}

export interface KevNormalized {
  listed: boolean;
  dateAdded: string | null;
  dueDate: string | null;
  shortDescription: string | null;
}

export interface EpssNormalized {
  score: number | null;
  percentile: number | null;
  date: string | null;
}

export type SourceNormalizedValue =
  | { source: 'nvd'; value: NvdNormalized }
  | { source: 'kev'; value: KevNormalized }
  | { source: 'epss'; value: EpssNormalized };

export interface EnrichmentOutcome {
  source: CveSourceName;
  status: CveSourceStatus;
  normalizedValue: SourceNormalizedValue | null;
  provenance: string;
}

export interface EnrichmentFailure {
  source: CveSourceName;
  status: 'failed' | 'transient_failure';
  error: string;
  provenance: string;
}

export interface EnrichmentAdapter {
  readonly source: CveSourceName;
  enrich(cveId: string): Promise<EnrichmentOutcome | EnrichmentFailure>;
}

export interface EnrichmentAdapterSet {
  nvd: EnrichmentAdapter;
  kev: EnrichmentAdapter;
  epss: EnrichmentAdapter;
}

/** True when the observation should be treated as a terminal current outcome. */
export function isTerminalStatus(status: CveSourceStatus): boolean {
  return status === 'ok' || status === 'not_found' || status === 'no_score';
}

/** A failing adapter MUST return this shape; helper for type narrowing. */
export function isEnrichmentFailure(outcome: EnrichmentOutcome | EnrichmentFailure): outcome is EnrichmentFailure {
  return outcome.status === 'failed' || outcome.status === 'transient_failure';
}
