import { CveCaseRepository, type CveSourceName } from '../db/repositories/cve-case.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import { stableStringify } from '../utils/stable-json.js';
import type { MaintenanceAdapterSet, NvdRefreshRecord } from './maintenance-adapters.js';
import type {
  EpssNormalized,
  KevNormalized,
  NvdNormalized,
  SourceNormalizedValue,
} from './enrichment.js';

/**
 * CVE enrichment maintenance scheduler (ADR 0006 / ticket #60).
 *
 * Runs three source-specific sub-passes sequentially on its own advisory-locked cadence:
 *
 *  - NVD: incremental by `lastModified` window using the stored cursor and the current time
 *    minus a 2-minute buffer. Only CVE ids whose normalized value changed get a new
 *    observation row; unchanged CVEs still advance the cursor.
 *  - KEV: full reconcile — fetch the entire catalogue, then for every stored CVE that is
 *    now listed (or was previously listed and is no longer) write a terminal observation.
 *  - EPSS: daily batch — fetch the full daily catalogue (or a specific scoreDate) and diff
 *    against stored scores; only CVEs whose score changed get a new observation row.
 *
 * The maintenance tick owns:
 *  - one-row-per-source `cve_refresh_state` cursor
 *  - per-source `attempt_kind` on the observation row (`maintenance_nvd` / `_kev` / `_epss`)
 *  - per-source "cases observed" / "observations appended" counters on the cursor row
 *  - `last_enriched_at` advancement only when an observation was actually appended
 *
 * Failed ticks do NOT advance the cursor for the failing source; the next tick resumes
 * from the same point. KEV and EPSS only run if NVD completed successfully, since the
 * spec calls for sequential recovery.
 */

const NVD_SAFETY_BUFFER_MS = 2 * 60 * 1000;
const NVD_INITIAL_CURSOR = '2020-01-01T00:00:00.000Z';

export interface MaintenanceTickResult {
  sources: {
    source: CveSourceName;
    status: 'ok' | 'failed' | 'transient_failure' | 'skipped';
    casesObserved: number;
    observationsAppended: number;
    cursorValue: string | null;
    error?: string;
    durationMs: number;
  }[];
  totalDurationMs: number;
}

export interface MaintenanceTickOptions {
  /** Override the current time for deterministic tests. */
  now?: () => Date;
  /** Override NVD's safety buffer (ms). Default 2 minutes. */
  nvdSafetyBufferMs?: number;
}

/**
 * Run a single maintenance tick across NVD → KEV → EPSS. Returns the per-source outcome
 * plus totals. Does NOT take an advisory lock — the caller is responsible for
 * `runScheduledMaintenance`.
 */
export async function runMaintenanceTick(
  db: Queryable,
  adapters: MaintenanceAdapterSet,
  options: MaintenanceTickOptions = {}
): Promise<MaintenanceTickResult> {
  const repo = new CveCaseRepository(db);
  const tickStartedAt = (options.now ?? (() => new Date()))();
  const sources: MaintenanceTickResult['sources'] = [];

  // ── NVD ────────────────────────────────────────────────────────────────────────
  const nvdStart = Date.now();
  let nvdCursor = NVD_INITIAL_CURSOR;
  let nvdCasesObserved = 0;
  let nvdAppended = 0;
  try {
    const existing = await repo.getRefreshState('nvd');
    nvdCursor = existing?.cursorValue ?? NVD_INITIAL_CURSOR;
    const endDate = new Date(tickStartedAt.getTime() - (options.nvdSafetyBufferMs ?? NVD_SAFETY_BUFFER_MS));
    const records = await adapters.nvd.fetchModified(nvdCursor, endDate.toISOString());
    const allCases = await repo.listAllCaseCveIds();
    const caseByCve = new Map(allCases.map((c) => [c.cveId.toUpperCase(), c.id]));
    let maxLastModified = nvdCursor;
    nvdCasesObserved = records.length;
    for (const record of records) {
      const caseId = caseByCve.get(record.cveId.toUpperCase());
      if (!caseId) continue; // NVD records for CVEs we don't track are ignored.
      const appended = await persistRefreshObservation(db, repo, caseId, 'nvd', record.normalized, 'maintenance_nvd');
      if (appended) nvdAppended += 1;
      if (record.lastModifiedAt && record.lastModifiedAt > maxLastModified) {
        maxLastModified = record.lastModifiedAt;
      }
    }
    const completedAt = new Date();
    await repo.upsertRefreshState({
      source: 'nvd',
      cursorValue: maxLastModified,
      lastTickStartedAt: tickStartedAt,
      lastTickCompletedAt: completedAt,
      lastTickStatus: 'ok',
      lastTickCasesObserved: nvdCasesObserved,
      lastTickObservationsAppended: nvdAppended,
      lastError: null,
    });
    sources.push({
      source: 'nvd',
      status: 'ok',
      casesObserved: nvdCasesObserved,
      observationsAppended: nvdAppended,
      cursorValue: maxLastModified,
      durationMs: Date.now() - nvdStart,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repo.upsertRefreshState({
      source: 'nvd',
      cursorValue: nvdCursor,
      lastTickStartedAt: tickStartedAt,
      lastTickCompletedAt: new Date(),
      lastTickStatus: 'failed',
      lastTickCasesObserved: nvdCasesObserved,
      lastTickObservationsAppended: nvdAppended,
      lastError: message,
    });
    sources.push({
      source: 'nvd',
      status: 'failed',
      casesObserved: nvdCasesObserved,
      observationsAppended: nvdAppended,
      cursorValue: nvdCursor,
      error: message,
      durationMs: Date.now() - nvdStart,
    });
    logError({ error: message }, 'cve_maintenance_nvd_failed');
    return { sources, totalDurationMs: Date.now() - nvdStart };
  }

  // ── KEV ────────────────────────────────────────────────────────────────────────
  const kevStart = Date.now();
  let kevCursor: string | null = (await repo.getRefreshState('kev'))?.cursorValue ?? null;
  let kevCasesObserved = 0;
  let kevAppended = 0;
  try {
    const allCases = await repo.listAllCaseCveIds();
    const caseByCve = new Map(allCases.map((c) => [c.cveId.toUpperCase(), c.id]));
    const kevCatalogue = await adapters.kev.fetchAll();
    kevCasesObserved = kevCatalogue.size;
    const newCursor = new Date().toISOString();
    for (const [cveId, normalized] of kevCatalogue.entries()) {
      const caseId = caseByCve.get(cveId);
      if (!caseId) continue;
      const value: KevNormalized = {
        listed: normalized.listed,
        dateAdded: normalized.dateAdded,
        dueDate: normalized.dueDate,
        shortDescription: normalized.shortDescription,
      };
      const appended = await persistRefreshObservation(
        db,
        repo,
        caseId,
        'kev',
        value,
        'maintenance_kev'
      );
      if (appended) kevAppended += 1;
    }
    await repo.upsertRefreshState({
      source: 'kev',
      cursorValue: newCursor,
      lastTickStartedAt: tickStartedAt,
      lastTickCompletedAt: new Date(),
      lastTickStatus: 'ok',
      lastTickCasesObserved: kevCasesObserved,
      lastTickObservationsAppended: kevAppended,
      lastError: null,
    });
    kevCursor = newCursor;
    sources.push({
      source: 'kev',
      status: 'ok',
      casesObserved: kevCasesObserved,
      observationsAppended: kevAppended,
      cursorValue: kevCursor,
      durationMs: Date.now() - kevStart,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repo.upsertRefreshState({
      source: 'kev',
      cursorValue: kevCursor,
      lastTickStartedAt: tickStartedAt,
      lastTickCompletedAt: new Date(),
      lastTickStatus: 'failed',
      lastTickCasesObserved: kevCasesObserved,
      lastTickObservationsAppended: kevAppended,
      lastError: message,
    });
    sources.push({
      source: 'kev',
      status: 'failed',
      casesObserved: kevCasesObserved,
      observationsAppended: kevAppended,
      cursorValue: kevCursor,
      error: message,
      durationMs: Date.now() - kevStart,
    });
    logError({ error: message }, 'cve_maintenance_kev_failed');
    return { sources, totalDurationMs: Date.now() - nvdStart };
  }

  // ── EPSS ───────────────────────────────────────────────────────────────────────
  const epssStart = Date.now();
  let epssCursor: string | null = (await repo.getRefreshState('epss'))?.cursorValue ?? null;
  let epssCasesObserved = 0;
  let epssAppended = 0;
  try {
    const allCases = await repo.listAllCaseCveIds();
    const caseByCve = new Map(allCases.map((c) => [c.cveId.toUpperCase(), c.id]));
    const dailyScores = await adapters.epss.fetchDaily();
    epssCasesObserved = dailyScores.size;
    const scoreDate = dailyScores.values().next().value?.date ?? null;
    const newCursor = scoreDate ?? new Date().toISOString().slice(0, 10);
    for (const [cveId, value] of dailyScores.entries()) {
      const caseId = caseByCve.get(cveId);
      if (!caseId) continue;
      const normalized: EpssNormalized = {
        score: value.score,
        percentile: value.percentile,
        date: value.date,
      };
      const appended = await persistRefreshObservation(
        db,
        repo,
        caseId,
        'epss',
        normalized,
        'maintenance_epss'
      );
      if (appended) epssAppended += 1;
    }
    await repo.upsertRefreshState({
      source: 'epss',
      cursorValue: newCursor,
      lastTickStartedAt: tickStartedAt,
      lastTickCompletedAt: new Date(),
      lastTickStatus: 'ok',
      lastTickCasesObserved: epssCasesObserved,
      lastTickObservationsAppended: epssAppended,
      lastError: null,
    });
    epssCursor = newCursor;
    sources.push({
      source: 'epss',
      status: 'ok',
      casesObserved: epssCasesObserved,
      observationsAppended: epssAppended,
      cursorValue: epssCursor,
      durationMs: Date.now() - epssStart,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repo.upsertRefreshState({
      source: 'epss',
      cursorValue: epssCursor,
      lastTickStartedAt: tickStartedAt,
      lastTickCompletedAt: new Date(),
      lastTickStatus: 'failed',
      lastTickCasesObserved: epssCasesObserved,
      lastTickObservationsAppended: epssAppended,
      lastError: message,
    });
    sources.push({
      source: 'epss',
      status: 'failed',
      casesObserved: epssCasesObserved,
      observationsAppended: epssAppended,
      cursorValue: epssCursor,
      error: message,
      durationMs: Date.now() - epssStart,
    });
    logError({ error: message }, 'cve_maintenance_epss_failed');
    return { sources, totalDurationMs: Date.now() - nvdStart };
  }

  logInfo(
    {
      sources: sources.map((s) => ({ source: s.source, status: s.status, appended: s.observationsAppended })),
      totalMs: Date.now() - nvdStart,
    },
    'cve_maintenance_tick_completed'
  );

  return { sources, totalDurationMs: Date.now() - nvdStart };
}

async function persistRefreshObservation(
  db: Queryable,
  repo: CveCaseRepository,
  caseId: string,
  source: CveSourceName,
  normalized: NvdNormalized | KevNormalized | EpssNormalized,
  attemptKind: 'maintenance_nvd' | 'maintenance_kev' | 'maintenance_epss'
): Promise<boolean> {
  const existing = await repo.listSourceObservations(caseId, source);
  const latestTerminal = existing.find(
    (obs) => obs.status === 'ok' || obs.status === 'not_found' || obs.status === 'no_score'
  );
  const wrapped: SourceNormalizedValue = { source, value: normalized } as SourceNormalizedValue;
  if (latestTerminal && sameNormalizedValue(latestTerminal.normalizedValue, wrapped)) {
    return false;
  }
  await repo.appendSourceObservation({
    caseId,
    source,
    status: 'ok',
    normalizedValue: wrapped as unknown as Record<string, unknown>,
    provenance: `cve-maintenance:${source}`,
    attemptKind,
    lastError: null,
  });
  // Advance the case-level last_enriched_at only when an observation was actually appended.
  await repo.markEnriched(caseId);
  return true;
}

function sameNormalizedValue(
  a: Record<string, unknown> | null,
  b: SourceNormalizedValue
): boolean {
  if (!a) return false;
  // Key order differs between stored jsonb and freshly-normalized values, so compare
  // canonically to avoid appending a spurious observation on an unchanged tick.
  return stableStringify(a) === stableStringify(b);
}

// Re-export so callers don't have to import the adapters module separately.
export type { MaintenanceAdapterSet, NvdRefreshRecord };