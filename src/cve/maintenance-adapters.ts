import type {
  EpssNormalized,
  KevNormalized,
  NvdNormalized,
} from './enrichment.js';
import type { CveSourceName } from '../db/repositories/cve-case.repository.js';

/**
 * Bulk-fetch adapters for the CVE enrichment maintenance scheduler (ADR 0006, ticket #60).
 *
 * The pipeline-side initial enrichment uses `EnrichmentAdapter` to look up a single CVE.
 * Maintenance instead fetches windows (NVD) or whole catalogues (KEV, EPSS) and diffs the
 * result against the stored case set. Each adapter is implemented by the production HTTP
 * client and by the test FixtureAdapter.
 */

export interface NvdRefreshRecord {
  cveId: string;
  normalized: NvdNormalized;
  lastModifiedAt: string | null;
}

export interface NvdRefreshAdapter {
  readonly source: CveSourceName;
  /**
   * Fetch all CVEs whose NVD `lastModified` falls in the half-open window
   * `[lastModStartDate, lastModEndDate)`. Throws on transient failures so the maintenance
   * scheduler can record a `transient_failure` row for the whole source.
   */
  fetchModified(lastModStartDate: string, lastModEndDate: string): Promise<NvdRefreshRecord[]>;
}

export interface KevRefreshAdapter {
  readonly source: CveSourceName;
  /** Fetch the full KEV catalogue and return it keyed by canonical CVE id (upper-cased). */
  fetchAll(): Promise<Map<string, KevNormalized & { dateAdded: string | null; dueDate: string | null; shortDescription: string | null }>>;
}

export interface EpssRefreshAdapter {
  readonly source: CveSourceName;
  /** Fetch the daily EPSS CSV and return it keyed by canonical CVE id (upper-cased). */
  fetchDaily(scoreDate?: string): Promise<Map<string, EpssNormalized & { date: string }>>;
}

export interface MaintenanceAdapterSet {
  nvd: NvdRefreshAdapter;
  kev: KevRefreshAdapter;
  epss: EpssRefreshAdapter;
}

export function isNvdRefreshAdapter(value: unknown): value is NvdRefreshAdapter {
  return Boolean(value && typeof (value as { fetchModified?: unknown }).fetchModified === 'function');
}
export function isKevRefreshAdapter(value: unknown): value is KevRefreshAdapter {
  return Boolean(value && typeof (value as { fetchAll?: unknown }).fetchAll === 'function');
}
export function isEpssRefreshAdapter(value: unknown): value is EpssRefreshAdapter {
  return Boolean(value && typeof (value as { fetchDaily?: unknown }).fetchDaily === 'function');
}