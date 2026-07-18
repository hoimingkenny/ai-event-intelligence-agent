import { AnalysisTaskRepository } from '../db/repositories/analysis-task.repository.js';
import {
  CveCaseRepository,
  type CveCaseArticleLifecycleState,
  type CveCaseRecord,
} from '../db/repositories/cve-case.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { buildEnrichmentAdapterSet, runInitialEnrichment } from './cases.js';
import type { EnrichmentAdapterSet } from './enrichment.js';

/**
 * Public surface for the human-gated review + publication workflow (ticket #59).
 *
 * The pipeline and the Workspace UI call this module rather than writing to the
 * underlying lifecycle / case tables directly. Every state transition writes a
 * `review_events` row, and the auto-revert rule runs after each verdict write so
 * the public surface stays consistent with the human-confirmed link count.
 */

export type HumanVerdict = 'human_confirmed' | 'human_rejected' | 'human_uncertain';

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

export interface PromoteUncertainInput {
  articleId: string;
  cveId: string;
  actor: string;
  reason?: string | null;
}

export interface PromoteUncertainResult {
  ok: boolean;
  caseId?: string;
  caseArticleId?: string;
  reason?: 'no_uncertain_relationship' | 'already_promoted';
}

interface RelevanceTaskResult {
  results?: Array<{ cveId: string; relevance: string; evidence: string }>;
}

/**
 * Story 30: a human promotes an uncertain article–CVE relationship to relevant. This
 * re-injects the pair into the normal deterministic workflow — it ensures one case per
 * canonical CVE, attaches the article as `automated_relevant` (a later human verdict is
 * still required for approval), runs initial enrichment, and records an audit event.
 */
export async function promoteUncertainRelationship(
  db: Queryable,
  input: PromoteUncertainInput,
  options: { adapters?: Partial<EnrichmentAdapterSet> } = {}
): Promise<PromoteUncertainResult> {
  const tasks = new AnalysisTaskRepository(db);
  const repo = new CveCaseRepository(db);

  const taskRows = await tasks.listForTarget('article', input.articleId);
  const relevanceTask = taskRows.find(
    (t) => t.taskName === 'article_cve_relevance' && t.status === 'completed'
  );
  const results = (relevanceTask?.result as RelevanceTaskResult | null)?.results ?? [];
  const match = results.find((r) => r.cveId === input.cveId && r.relevance === 'uncertain');
  if (!relevanceTask || !match) {
    return { ok: false, reason: 'no_uncertain_relationship' };
  }

  const existingCaseId = (await repo.listCaseIdsForCves([input.cveId])).get(input.cveId) ?? null;
  if (existingCaseId) {
    const existing = await repo.findCaseArticle(existingCaseId, input.articleId);
    if (existing) {
      return { ok: false, reason: 'already_promoted', caseId: existingCaseId, caseArticleId: existing.id };
    }
  }

  const caseRecord = await repo.ensureCase(input.cveId, input.articleId);
  const evidencePayload = {
    automated_relevance: 'relevant',
    automated_evidence: match.evidence,
    automated_at: relevanceTask.completedAt?.toISOString() ?? new Date().toISOString(),
    automated_task_id: relevanceTask.id,
    promoted_from: 'uncertain',
    promoted_by: input.actor,
  };
  const caseArticle = await repo.upsertCaseArticle({
    caseId: caseRecord.id,
    articleId: input.articleId,
    lifecycleState: 'automated_relevant',
    evidence: evidencePayload,
    firstEvidence: evidencePayload,
    automatedTaskId: relevanceTask.id,
  });

  await repo.appendReviewEvent({
    caseId: caseRecord.id,
    caseArticleId: caseArticle.id,
    actor: input.actor,
    eventKind: 'human_verdict',
    fromState: 'uncertain',
    toState: 'automated_relevant',
    reason: input.reason ?? 'promoted uncertain relationship to relevant',
    payload: { articleId: input.articleId, cveId: input.cveId },
  });

  const adapters = buildEnrichmentAdapterSet({ adapters: options.adapters });
  await runInitialEnrichment(db, [caseRecord.id], adapters);

  return { ok: true, caseId: caseRecord.id, caseArticleId: caseArticle.id };
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

  const caseArticle = await repo.findCaseArticle(input.caseId, input.articleId);
  if (!caseArticle) {
    return { ok: false, caseArticleId: null, fromState: null, toState: null, reason: 'case_article_not_found' };
  }

  if (caseArticle.lifecycleState === input.verdict) {
    return {
      ok: true,
      caseArticleId: caseArticle.id,
      fromState: caseArticle.lifecycleState,
      toState: caseArticle.lifecycleState,
      reason: 'no_change',
    };
  }

  const updated = await repo.updateCaseArticleLifecycleState(caseArticle.id, input.verdict);
  await repo.appendReviewEvent({
    caseId: caseRecord.id,
    caseArticleId: caseArticle.id,
    actor: input.actor,
    eventKind: 'human_verdict',
    fromState: caseArticle.lifecycleState,
    toState: input.verdict,
    reason: input.reason ?? null,
    payload: { articleId: input.articleId },
  });

  const autoRevertedCaseId = await maybeAutoRevert(repo, caseRecord, input.actor);

  return {
    ok: true,
    caseArticleId: updated?.id ?? caseArticle.id,
    fromState: caseArticle.lifecycleState,
    toState: input.verdict,
    autoRevertedCaseId,
  };
}

export async function approveCase(db: Queryable, input: ApproveCaseInput): Promise<ApproveCaseResult> {
  const repo = new CveCaseRepository(db);
  const caseRecord = await repo.findCaseById(input.caseId);
  if (!caseRecord) return { ok: false, reason: 'case_not_found' };

  const requirements = await checkApprovalRequirements(db, caseRecord.id);
  if (!requirements.ok) {
    const blockedBy: Array<{ articleId?: string; reason: ApprovalBlockReason }> = [];
    if (requirements.confirmedLinkCount === 0) blockedBy.push({ reason: 'no_human_confirmed_link' });
    for (const articleId of requirements.articlesMissingSummary) {
      blockedBy.push({ articleId, reason: 'article_missing_summary' });
    }
    for (const source of requirements.missingSources) {
      blockedBy.push({ reason: `missing_${source}_observation` as ApprovalBlockReason });
    }
    const reason = blockedBy[0]?.reason ?? 'no_human_confirmed_link';
    return { ok: false, reason, blockedBy };
  }

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

async function maybeAutoRevert(
  repo: CveCaseRepository,
  caseRecord: CveCaseRecord,
  actor: string
): Promise<string | undefined> {
  if (caseRecord.status !== 'approved') return undefined;
  const confirmed = await repo.countConfirmedLinks(caseRecord.id);
  if (confirmed > 0) return undefined;
  await repo.markAutoReverted(caseRecord.id, actor);
  await repo.appendReviewEvent({
    caseId: caseRecord.id,
    caseArticleId: null,
    actor,
    eventKind: 'auto_revert',
    fromState: 'approved',
    toState: 'draft',
    reason: 'last human_confirmed link removed',
    payload: {},
  });
  return caseRecord.id;
}

export function isHumanVerdict(value: string): value is HumanVerdict {
  return value === 'human_confirmed' || value === 'human_rejected' || value === 'human_uncertain';
}

// Re-exported so callers don't have to import the enrichment module separately when
// wiring adapters to the workspace page.
export type { EnrichmentAdapterSet };
