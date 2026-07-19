import { AnalysisTaskRepository } from '../db/repositories/analysis-task.repository.js';
import {
  CveCaseRepository,
  type CveCaseArticleLifecycleState,
  type CveCaseRecord,
  type CveSourceObservationRecord,
} from '../db/repositories/cve-case.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import type { EnrichmentAdapterSet, NvdNormalized } from './enrichment.js';

/**
 * Public surface for the CVE case review + publication workflow.
 *
 * Publication is automatic when NVD CVSS ≥ {@link CVSS_AUTO_PUBLISH_THRESHOLD}
 * **or** the CVE is listed in CISA KEV. Analysts can pull a case back from the
 * public catalogue at any time; the next enrichment/refresh that still meets a
 * gate will publish it again.
 */

export type HumanVerdict = 'human_confirmed' | 'human_rejected' | 'human_uncertain';

/** NVD CVSS base score at or above this value auto-publishes the case. */
export const CVSS_AUTO_PUBLISH_THRESHOLD = 9;
export const CVSS_AUTO_PUBLISH_ACTOR = 'system:cvss_auto_publish';

const TERMINAL_OBSERVATION_STATUSES = new Set(['ok', 'not_found', 'no_score']);

export interface RecordHumanVerdictInput {
  caseId: string;
  articleId: string;
  verdict: HumanVerdict;
  actor: string;
  reason?: string | null;
}

export interface RecordHumanVerdictResult {
  ok: boolean;
  caseArticleId: string | null;
  fromState: CveCaseArticleLifecycleState | null;
  toState: CveCaseArticleLifecycleState | null;
  reason?:
    | 'case_not_found'
    | 'case_article_not_found'
    | 'invalid_verdict'
    | 'no_change';
  autoRevertedCaseId?: string;
}

export interface ApproveCaseInput {
  caseId: string;
  actor: string;
  reason?: string | null;
}

export type ApprovalBlockReason =
  | 'case_not_found'
  | 'no_human_confirmed_link'
  | 'article_missing_summary'
  | 'missing_nvd_observation'
  | 'missing_kev_observation'
  | 'missing_epss_observation';

export interface ApproveCaseResult {
  ok: boolean;
  reason?: ApprovalBlockReason;
  blockedBy?: Array<{ articleId?: string; reason: ApprovalBlockReason }>;
  caseRecord?: CveCaseRecord | null;
}

export interface ApprovalRequirements {
  ok: boolean;
  confirmedLinkCount: number;
  articlesMissingSummary: string[];
  missingSources: Array<'nvd' | 'kev' | 'epss'>;
}

export interface UnpublishCaseInput {
  caseId: string;
  actor: string;
  reason?: string | null;
}

export interface UnpublishCaseResult {
  ok: boolean;
  reason?: 'case_not_found' | 'not_published';
  caseRecord?: CveCaseRecord | null;
}

export interface SyncPublicationResult {
  caseId: string;
  action: 'published' | 'unpublished' | 'unchanged';
  cvssBase: number | null;
}

export async function recordHumanVerdict(
  db: Queryable,
  input: RecordHumanVerdictInput
): Promise<RecordHumanVerdictResult> {
  if (!isHumanVerdict(input.verdict)) {
    return { ok: false, caseArticleId: null, fromState: null, toState: null, reason: 'invalid_verdict' };
  }

  const repo = new CveCaseRepository(db);
  const caseRecord = await repo.findCaseById(input.caseId);
  if (!caseRecord) {
    return { ok: false, caseArticleId: null, fromState: null, toState: null, reason: 'case_not_found' };
  }

  const link = await repo.findCaseArticle(input.caseId, input.articleId);
  if (!link) {
    return { ok: false, caseArticleId: null, fromState: null, toState: null, reason: 'case_article_not_found' };
  }

  if (link.lifecycleState === input.verdict) {
    return {
      ok: true,
      caseArticleId: link.id,
      fromState: link.lifecycleState,
      toState: link.lifecycleState,
      reason: 'no_change',
    };
  }

  const fromState = link.lifecycleState;
  const updated = await repo.updateCaseArticleLifecycleState(link.id, input.verdict);
  await repo.appendReviewEvent({
    caseId: input.caseId,
    caseArticleId: link.id,
    actor: input.actor,
    eventKind: 'human_verdict',
    fromState,
    toState: input.verdict,
    reason: input.reason ?? null,
    payload: { articleId: input.articleId },
  });

  return {
    ok: true,
    caseArticleId: updated?.id ?? link.id,
    fromState,
    toState: input.verdict,
  };
}

/**
 * Force-publish a case (tests / rare manual override). Production publication is
 * driven by {@link syncCasePublicationFromCvss}.
 */
export async function approveCase(db: Queryable, input: ApproveCaseInput): Promise<ApproveCaseResult> {
  const repo = new CveCaseRepository(db);
  const caseRecord = await repo.findCaseById(input.caseId);
  if (!caseRecord) return { ok: false, reason: 'case_not_found' };

  if (caseRecord.status === 'approved') {
    return { ok: true, caseRecord };
  }

  await repo.markApproved(caseRecord.id, input.actor);
  await repo.appendReviewEvent({
    caseId: caseRecord.id,
    caseArticleId: null,
    actor: input.actor,
    eventKind: 'approval',
    fromState: 'draft',
    toState: 'approved',
    reason: input.reason ?? null,
    payload: {},
  });

  const fresh = await repo.findCaseById(caseRecord.id);
  return { ok: true, caseRecord: fresh };
}

/** Pull a published case back from the public catalogue. */
export async function unpublishCase(db: Queryable, input: UnpublishCaseInput): Promise<UnpublishCaseResult> {
  const repo = new CveCaseRepository(db);
  const caseRecord = await repo.findCaseById(input.caseId);
  if (!caseRecord) return { ok: false, reason: 'case_not_found' };
  if (caseRecord.status !== 'approved') return { ok: false, reason: 'not_published' };

  await repo.markUnpublished(caseRecord.id, input.actor);
  await repo.appendReviewEvent({
    caseId: caseRecord.id,
    caseArticleId: null,
    actor: input.actor,
    eventKind: 'unapproval',
    fromState: 'approved',
    toState: 'draft',
    reason: input.reason ?? 'pulled_back_from_public',
    payload: {},
  });

  const fresh = await repo.findCaseById(caseRecord.id);
  return { ok: true, caseRecord: fresh };
}

/**
 * Publish when NVD CVSS ≥ threshold or CISA KEV lists the CVE; unpublish when
 * neither gate holds. Idempotent. Called after enrichment / maintenance.
 */
export async function syncCasePublicationFromCvss(
  db: Queryable,
  caseId: string
): Promise<SyncPublicationResult> {
  const repo = new CveCaseRepository(db);
  const caseRecord = await repo.findCaseById(caseId);
  if (!caseRecord) {
    return { caseId, action: 'unchanged', cvssBase: null };
  }

  const observations = await repo.listCurrentTerminalObservations(caseId);
  const cvssBase = readCvssBase(observations.get('nvd'));
  const kevListed = readKevListed(observations.get('kev'));
  const shouldPublish =
    (cvssBase != null && cvssBase >= CVSS_AUTO_PUBLISH_THRESHOLD) || kevListed;

  if (shouldPublish && caseRecord.status !== 'approved') {
    await repo.markApproved(caseId, CVSS_AUTO_PUBLISH_ACTOR);
    await repo.appendReviewEvent({
      caseId,
      caseArticleId: null,
      actor: CVSS_AUTO_PUBLISH_ACTOR,
      eventKind: 'approval',
      fromState: 'draft',
      toState: 'approved',
      reason: 'auto_publish',
      payload: { cvssBase, kevListed },
    });
    return { caseId, action: 'published', cvssBase };
  }

  if (!shouldPublish && caseRecord.status === 'approved') {
    await repo.markUnpublished(caseId, CVSS_AUTO_PUBLISH_ACTOR);
    await repo.appendReviewEvent({
      caseId,
      caseArticleId: null,
      actor: CVSS_AUTO_PUBLISH_ACTOR,
      eventKind: 'unapproval',
      fromState: 'approved',
      toState: 'draft',
      reason: 'auto_publish_gates_cleared',
      payload: { cvssBase, kevListed },
    });
    return { caseId, action: 'unpublished', cvssBase };
  }

  return { caseId, action: 'unchanged', cvssBase };
}

export async function syncAllCasePublicationsFromCvss(db: Queryable): Promise<SyncPublicationResult[]> {
  const repo = new CveCaseRepository(db);
  const cases = await repo.listAllCases();
  const results: SyncPublicationResult[] = [];
  for (const caseRecord of cases) {
    results.push(await syncCasePublicationFromCvss(db, caseRecord.id));
  }
  return results;
}

/** @deprecated Human-gated approval requirements are no longer used for publication. */
export async function checkApprovalRequirements(db: Queryable, caseId: string): Promise<ApprovalRequirements> {
  const repo = new CveCaseRepository(db);
  const caseArticles = await repo.listCaseArticlesByCase(caseId);
  const tasks = new AnalysisTaskRepository(db);

  const visible = caseArticles.filter(
    (row) => row.lifecycleState === 'human_confirmed' || row.lifecycleState === 'automated_relevant'
  );
  const confirmedCount = caseArticles.filter((row) => row.lifecycleState === 'human_confirmed').length;

  const articlesMissingSummary: string[] = [];
  for (const row of visible) {
    const taskRows = await tasks.listForTarget('article', row.articleId);
    const summary = taskRows.find((t) => t.taskName === 'article_summary');
    if (!summary || summary.status !== 'completed') {
      articlesMissingSummary.push(row.articleId);
    }
  }

  const observations = await repo.listSourceObservations(caseId);
  const haveSource = new Set<string>();
  for (const obs of observations) {
    if (TERMINAL_OBSERVATION_STATUSES.has(obs.status)) {
      haveSource.add(obs.source);
    }
  }
  const missingSources: Array<'nvd' | 'kev' | 'epss'> = [];
  for (const source of ['nvd', 'kev', 'epss'] as const) {
    if (!haveSource.has(source)) missingSources.push(source);
  }

  const ok = confirmedCount > 0 && articlesMissingSummary.length === 0 && missingSources.length === 0;
  return { ok, confirmedLinkCount: confirmedCount, articlesMissingSummary, missingSources };
}

function readCvssBase(obs: CveSourceObservationRecord | undefined): number | null {
  if (!obs || obs.status !== 'ok') return null;
  const value = (obs.normalizedValue as { value?: NvdNormalized } | null)?.value ?? null;
  const base = value?.cvssV3?.base ?? value?.cvssV2?.base ?? null;
  return typeof base === 'number' && Number.isFinite(base) ? base : null;
}

function readKevListed(obs: CveSourceObservationRecord | undefined): boolean {
  if (!obs || obs.status !== 'ok') return false;
  const value = (obs.normalizedValue as { value?: { listed?: unknown } } | null)?.value ?? null;
  return value?.listed === true;
}

export function isHumanVerdict(value: string): value is HumanVerdict {
  return value === 'human_confirmed' || value === 'human_rejected' || value === 'human_uncertain';
}

// Re-exported so callers don't have to import the enrichment module separately when
// wiring adapters to the workspace page.
export type { EnrichmentAdapterSet };
