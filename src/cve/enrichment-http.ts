import type { EnrichmentAdapter, EnrichmentFailure, EnrichmentOutcome } from './enrichment.js';
import type { CveSourceName } from '../db/repositories/cve-case.repository.js';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface HttpFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function fetchJson(url: string, options: HttpFetchOptions = {}): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

interface NvdDescription {
  lang?: string;
  value: string;
}
interface NvdCvssV3Metric {
  cvssData?: { baseScore?: number; vectorString?: string };
}
interface NvdCvssV2Metric {
  cvssData?: { baseScore?: number; vectorString?: string };
}
interface NvdVulnerability {
  cve?: {
    id?: string;
    descriptions?: NvdDescription[];
    metrics?: {
      cvssMetricV31?: NvdCvssV3Metric[];
      cvssMetricV30?: NvdCvssV3Metric[];
      cvssMetricV2?: NvdCvssV2Metric[];
    };
    published?: string;
    lastModified?: string;
  };
}

export class NvdHttpAdapter implements EnrichmentAdapter {
  readonly source: CveSourceName = 'nvd';
  private readonly baseUrl: string;
  private readonly httpOptions: HttpFetchOptions;

  constructor(options: { baseUrl?: string; httpOptions?: HttpFetchOptions } = {}) {
    this.baseUrl = options.baseUrl ?? 'https://services.nvd.nist.gov/rest/json/cves/2.0';
    this.httpOptions = options.httpOptions ?? {};
  }

  async enrich(cveId: string): Promise<EnrichmentOutcome | EnrichmentFailure> {
    const provenance = `NVD HTTP ${this.baseUrl}`;
    try {
      const url = `${this.baseUrl}?cveId=${encodeURIComponent(cveId)}`;
      const payload = await fetchJson(url, this.httpOptions);
      const vulns = (payload as { vulnerabilities?: NvdVulnerability[] }).vulnerabilities ?? [];
      const match = vulns.find((v) => v.cve?.id?.toUpperCase() === cveId.toUpperCase()) ?? vulns[0];
      if (!match?.cve) {
        return { source: 'nvd', status: 'not_found', normalizedValue: null, provenance };
      }
      const englishDescription =
        match.cve.descriptions?.find((d) => d.lang === 'en')?.value ??
        match.cve.descriptions?.[0]?.value ??
        null;
      const v3 = match.cve.metrics?.cvssMetricV31?.[0]?.cvssData ?? match.cve.metrics?.cvssMetricV30?.[0]?.cvssData ?? null;
      const v2 = match.cve.metrics?.cvssMetricV2?.[0]?.cvssData ?? null;
      const normalized = {
        source: 'nvd' as const,
        value: {
          description: englishDescription,
          cvssV3: v3?.baseScore != null && v3.vectorString ? { base: v3.baseScore, vector: v3.vectorString } : null,
          cvssV2: v2?.baseScore != null && v2.vectorString ? { base: v2.baseScore, vector: v2.vectorString } : null,
          publishedAt: match.cve.published ?? null,
          lastModifiedAt: match.cve.lastModified ?? null,
        },
      };
      return { source: 'nvd', status: 'ok', normalizedValue: normalized, provenance };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transient = isTransient(message);
      return {
        source: 'nvd',
        status: transient ? 'transient_failure' : 'failed',
        error: message,
        provenance,
      };
    }
  }
}

interface KevEntry {
  cveID?: string;
  dateAdded?: string;
  dueDate?: string;
  shortDescription?: string;
}

export class KevHttpAdapter implements EnrichmentAdapter {
  readonly source: CveSourceName = 'kev';
  private readonly baseUrl: string;
  private readonly httpOptions: HttpFetchOptions;

  constructor(options: { baseUrl?: string; httpOptions?: HttpFetchOptions } = {}) {
    this.baseUrl = options.baseUrl ?? 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
    this.httpOptions = options.httpOptions ?? {};
  }

  async enrich(cveId: string): Promise<EnrichmentOutcome | EnrichmentFailure> {
    const provenance = `CISA KEV HTTP ${this.baseUrl}`;
    try {
      const payload = await fetchJson(this.baseUrl, this.httpOptions);
      const entries = (payload as { vulnerabilities?: KevEntry[] }).vulnerabilities ?? [];
      const entry = entries.find((e) => e.cveID?.toUpperCase() === cveId.toUpperCase());
      if (!entry) {
        return {
          source: 'kev',
          status: 'ok',
          normalizedValue: { source: 'kev', value: { listed: false, dateAdded: null, dueDate: null, shortDescription: null } },
          provenance,
        };
      }
      return {
        source: 'kev',
        status: 'ok',
        normalizedValue: {
          source: 'kev',
          value: {
            listed: true,
            dateAdded: entry.dateAdded ?? null,
            dueDate: entry.dueDate ?? null,
            shortDescription: entry.shortDescription ?? null,
          },
        },
        provenance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        source: 'kev',
        status: isTransient(message) ? 'transient_failure' : 'failed',
        error: message,
        provenance,
      };
    }
  }
}

interface EpssDatum {
  cve?: string;
  epss?: string;
  percentile?: string;
  date?: string;
}

export class EpssHttpAdapter implements EnrichmentAdapter {
  readonly source: CveSourceName = 'epss';
  private readonly baseUrl: string;
  private readonly httpOptions: HttpFetchOptions;

  constructor(options: { baseUrl?: string; httpOptions?: HttpFetchOptions } = {}) {
    this.baseUrl = options.baseUrl ?? 'https://api.first.org/data/v1/epss';
    this.httpOptions = options.httpOptions ?? {};
  }

  async enrich(cveId: string): Promise<EnrichmentOutcome | EnrichmentFailure> {
    const provenance = `FIRST EPSS HTTP ${this.baseUrl}`;
    try {
      const url = `${this.baseUrl}?cve=${encodeURIComponent(cveId)}`;
      const payload = await fetchJson(url, this.httpOptions);
      const data = (payload as { data?: EpssDatum[] }).data ?? [];
      const datum = data.find((d) => d.cve?.toUpperCase() === cveId.toUpperCase());
      if (!datum || datum.epss == null) {
        return {
          source: 'epss',
          status: 'no_score',
          normalizedValue: { source: 'epss', value: { score: null, percentile: null, date: null } },
          provenance,
        };
      }
      const score = Number(datum.epss);
      const percentile = datum.percentile != null ? Number(datum.percentile) : null;
      return {
        source: 'epss',
        status: 'ok',
        normalizedValue: {
          source: 'epss',
          value: {
            score: Number.isFinite(score) ? score : null,
            percentile: percentile != null && Number.isFinite(percentile) ? percentile : null,
            date: datum.date ?? null,
          },
        },
        provenance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        source: 'epss',
        status: isTransient(message) ? 'transient_failure' : 'failed',
        error: message,
        provenance,
      };
    }
  }
}

function isTransient(message: string): boolean {
  return /HTTP 5\d\d|HTTP 429|HTTP 408|aborted|timeout|ECONNRESET|ETIMEDOUT/i.test(message);
}
