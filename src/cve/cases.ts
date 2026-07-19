import { ArticleRepository } from '../db/repositories/article.repository.js';
import {
  CveCaseRepository,
  type CveCaseArticleRecord,
  type CveCaseRecord,
  type CveSourceAttemptKind,
  type CveSourceName,
  type CveSourceObservationRecord,
} from '../db/repositories/cve-case.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import {
  isEnrichmentFailure,
  type EnrichmentAdapterSet,
  type EnrichmentFailure,
  type EnrichmentOutcome,
} from './enrichment.js';
import { EpssHttpAdapter, KevHttpAdapter, NvdHttpAdapter } from './enrichment-http.js';
import { stableStringify } from '../utils/stable-json.js';
import type { MaintenanceAdapterSet } from './maintenance-adapters.js';

export type { EnrichmentAdapter, EnrichmentAdapterSet } from './enrichment.js';
export type {
  EpssRefreshAdapter,
  KevRefreshAdapter,
  MaintenanceAdapterSet,
  NvdRefreshAdapter,
  NvdRefreshRecord,
} from './maintenance-adapters.js';

/**
 * Public surface of the deep CVE module.
 *
 * The module hides four write concerns:
 *  1. cve_cases                       — one row per canonical CVE identifier
 *  2. cve_case_articles               — article–CVE lifecycle (mentioned → automated_relevant → human_*)
 *  3. cve_source_observations         — NVD / KEV / EPSS append-only snapshots
 *  4. review_events                   — append-only review history (added in #59; surface exists here for read parity)
 *
 * Pipeline and UI code call this module rather than coordinating the tables directly.
 */

export interface ArticleCveRelevanceEvidence {
  cveId: string;
  relevance: 'relevant' | 'not_relevant' | 'uncertain';
  evidence: string;
  automatedAt: string;
  automatedTaskId: string | null;
}

export interface AttachArticleInput {
  cveId: string;
  articleId: string;
  lifecycleState: CveCaseArticleRecord['lifecycleState'];
  evidence: ArticleCveRelevanceEvidence;
}

export interface ConsolidatedResult {
  casesEnsured: number;
  articlesAttached: number;
  observationsAppended: number;
  cases: CveCaseRecord[];
}

export interface EnrichmentRunResult {
  attempted: number;
  appended: number;
  failed: number;
  transient: number;
}

export function buildEnrichmentAdapterSet(options: {
  adapters?: Partial<EnrichmentAdapterSet>;
}): EnrichmentAdapterSet {
  return {
    nvd: options.adapters?.nvd ?? new NvdHttpAdapter(),
    kev: options.adapters?.kev ?? new KevHttpAdapter(),
    epss: options.adapters?.epss ?? new EpssHttpAdapter(),
  };
}

export function buildMaintenanceAdapterSet(options: {
  adapters?: Partial<MaintenanceAdapterSet>;
}): MaintenanceAdapterSet {
  return {
    nvd: options.adapters?.nvd ?? new NvdHttpAdapter(),
    kev: options.adapters?.kev ?? new KevHttpAdapter(),
    epss: options.adapters?.epss ?? new EpssHttpAdapter(),
  };
}

/**
 * Idempotent end-of-batch consolidation.
 *
 * Given a list of completed relevance outcomes (one per (article, cveId) pair), create
 * or reuse one cve_cases row per canonical CVE and one cve_case_articles row per
 * (case, article). Retrying / uncertain / needs_attention tasks are excluded upstream
 * and must not appear in `evidence` here.
 */
export async function consolidateArticleCveEvidence(
  db: Queryable,
  evidence: AttachArticleInput[]
): Promise<ConsolidatedResult> {
  const repo = new CveCaseRepository(db);
  const articles = new ArticleRepository(db);

  const cveIds = Array.from(new Set(evidence.map((e) => e.cveId)));
  const existingCases = await repo.listCaseIdsForCves(cveIds);

  const ensuredCases: CveCaseRecord[] = [];
  for (const cveId of cveIds) {
    const firstSeenArticleId =
      evidence.find((e) => e.cveId === cveId)?.articleId ?? null;
    const record = await repo.ensureCase(cveId, firstSeenArticleId);
    ensuredCases.push(record);
  }

  let articlesAttached = 0;
  for (const item of evidence) {
    const ensured = ensuredCases.find((c) => c.cveId === item.cveId);
    if (!ensured) continue;
    const article = await articles.findByIds([item.articleId]).then((rows) => rows[0] ?? null);
    if (!article) continue;

    const lifecycleState = mapLifecycleState(item);
    const evidencePayload = {
      automated_relevance: item.evidence.relevance,
      automated_evidence: item.evidence.evidence,
      automated_at: item.evidence.automatedAt,
      automated_task_id: item.evidence.automatedTaskId,
    };
    await repo.upsertCaseArticle({
      caseId: ensured.id,
      articleId: item.articleId,
      lifecycleState,
      evidence: evidencePayload,
      firstEvidence: evidencePayload,
      automatedTaskId: item.evidence.automatedTaskId,
    });
    articlesAttached += 1;
  }

  return {
    casesEnsured: ensuredCases.length,
    articlesAttached,
    observationsAppended: 0,
    cases: ensuredCases,
  };
}

/**
 * Run initial NVD/KEV/EPSS enrichment for a set of cases. Idempotent: existing terminal
 * observations are preserved per the change/no-change/never-overwrite rules defined in
 * the source layer (`shouldAppendObservation`).
 */
export async function runInitialEnrichment(
  db: Queryable,
  caseIds: string[],
  adapters: EnrichmentAdapterSet
): Promise<EnrichmentRunResult> {
  const repo = new CveCaseRepository(db);
  let appended = 0;
  let failed = 0;
  let transient = 0;

  for (const caseId of caseIds) {
    const caseRecord = await repo.findCaseById(caseId);
    if (!caseRecord) continue;

    for (const source of ['nvd', 'kev', 'epss'] as const) {
      const outcome = await adapters[source].enrich(caseRecord.cveId);
      const result = await persistObservation(db, caseRecord, source, outcome, 'initial');
      if (result === 'appended') appended += 1;
      else if (result === 'failed') failed += 1;
      else if (result === 'transient') transient += 1;
    }
    await repo.markEnriched(caseId);
  }

  return { attempted: caseIds.length * 3, appended, failed, transient };
}

export async function getCaseWorkspaceView(
  db: Queryable,
  caseId: string
): Promise<CveCaseWorkspaceView | null> {
  const repo = new CveCaseRepository(db);
  const caseRecord = await repo.findCaseById(caseId);
  if (!caseRecord) return null;

  const caseArticles = await repo.listCaseArticlesByCase(caseId);
  const currentObservations = await repo.listCurrentObservations(caseId);
  const allObservations = await repo.listSourceObservations(caseId);

  return {
    case: caseRecord,
    caseArticles,
    currentObservations,
    observations: allObservations,
  };
}

export interface CveCaseWorkspaceView {
  case: CveCaseRecord;
  caseArticles: CveCaseArticleRecord[];
  currentObservations: Map<CveSourceName, CveSourceObservationRecord>;
  observations: CveSourceObservationRecord[];
}

async function persistObservation(
  db: Queryable,
  caseRecord: CveCaseRecord,
  source: CveSourceName,
  outcome: EnrichmentOutcome | EnrichmentFailure,
  attemptKind: CveSourceAttemptKind
): Promise<'appended' | 'unchanged' | 'failed' | 'transient'> {
  const repo = new CveCaseRepository(db);

  if (isEnrichmentFailure(outcome)) {
    await repo.appendSourceObservation({
      caseId: caseRecord.id,
      source,
      status: outcome.status,
      normalizedValue: null,
      provenance: outcome.provenance,
      attemptKind,
      lastError: outcome.error,
    });
    return outcome.status === 'transient_failure' ? 'transient' : 'failed';
  }

  const existing = await repo.listSourceObservations(caseRecord.id, source);
  const latestTerminal = existing.find((obs) =>
    obs.status === 'ok' || obs.status === 'not_found' || obs.status === 'no_score'
  );
  if (latestTerminal && sameNormalizedValue(latestTerminal.normalizedValue, outcome.normalizedValue)) {
    return 'unchanged';
  }

  await repo.appendSourceObservation({
    caseId: caseRecord.id,
    source,
    status: outcome.status,
    normalizedValue: outcome.normalizedValue ?? null,
    provenance: outcome.provenance,
    attemptKind,
    lastError: null,
  });
  return 'appended';
}

function mapLifecycleState(item: AttachArticleInput): CveCaseArticleRecord['lifecycleState'] {
  if (item.evidence.relevance === 'relevant') return 'automated_relevant';
  if (item.evidence.relevance === 'not_relevant') return 'mentioned';
  return 'mentioned';
}

function sameNormalizedValue(
  a: CveSourceObservationRecord['normalizedValue'],
  b: EnrichmentOutcome['normalizedValue']
): boolean {
  // Key order differs between stored jsonb and freshly-normalized values, so compare
  // canonically to avoid appending a spurious observation for unchanged enrichment.
  return stableStringify(a) === stableStringify(b);
}
