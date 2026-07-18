import { CveCaseRepository } from '../db/repositories/cve-case.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import {
  buildEnrichmentAdapterSet,
  consolidateArticleCveEvidence,
  runInitialEnrichment,
  type AttachArticleInput,
} from '../cve/cases.js';
import type { EnrichmentAdapterSet } from '../cve/enrichment.js';

export interface CaseConsolidationStageResult {
  evidenceCollected: number;
  casesEnsured: number;
  articlesAttached: number;
  enrichmentAttempted: number;
  enrichmentAppended: number;
  enrichmentFailed: number;
  enrichmentTransient: number;
}

export interface CaseConsolidationStageOptions {
  limit?: number;
  adapters?: Partial<EnrichmentAdapterSet>;
}

const RELEVANCE_TASK_NAME = 'article_cve_relevance';

interface RelevanceTaskRecord {
  id: string;
  targetId: string;
  result: { results?: Array<{ cveId: string; relevance: string; evidence: string }> } | null;
  completedAt: Date | null;
}

export async function runCaseConsolidationStage(
  db: Queryable,
  options: CaseConsolidationStageOptions = {}
): Promise<CaseConsolidationStageResult> {
  const cases = new CveCaseRepository(db);
  const adapters = buildEnrichmentAdapterSet({ adapters: options.adapters });

  const evidenceInputs = await collectRelevantEvidence(db, options.limit ?? 200);

  if (evidenceInputs.length === 0) {
    return {
      evidenceCollected: 0,
      casesEnsured: 0,
      articlesAttached: 0,
      enrichmentAttempted: 0,
      enrichmentAppended: 0,
      enrichmentFailed: 0,
      enrichmentTransient: 0,
    };
  }

  const consolidation = await consolidateArticleCveEvidence(db, evidenceInputs);

  const newCaseIds: string[] = [];
  for (const ensured of consolidation.cases) {
    const existingObservations = await cases.listCurrentObservations(ensured.id);
    if (existingObservations.size === 0) newCaseIds.push(ensured.id);
  }

  const enrichment = await runInitialEnrichment(db, newCaseIds, adapters);

  return {
    evidenceCollected: evidenceInputs.length,
    casesEnsured: consolidation.casesEnsured,
    articlesAttached: consolidation.articlesAttached,
    enrichmentAttempted: enrichment.attempted,
    enrichmentAppended: enrichment.appended,
    enrichmentFailed: enrichment.failed,
    enrichmentTransient: enrichment.transient,
  };
}

async function collectRelevantEvidence(
  db: Queryable,
  limit: number
): Promise<AttachArticleInput[]> {
  const queued: AttachArticleInput[] = [];
  const seen = new Set<string>();

  const completedRelevance = await listCompletedRelevanceTasks(db, limit);
  for (const task of completedRelevance) {
    const results = task.result?.results ?? [];
    for (const item of results) {
      if (item.relevance !== 'relevant') continue;
      const dedupeKey = `${task.targetId}:${item.cveId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      queued.push({
        cveId: item.cveId,
        articleId: task.targetId,
        lifecycleState: 'automated_relevant',
        evidence: {
          cveId: item.cveId,
          relevance: 'relevant',
          evidence: item.evidence,
          automatedAt: task.completedAt?.toISOString() ?? new Date().toISOString(),
          automatedTaskId: task.id,
        },
      });
    }
  }
  return queued;
}

async function listCompletedRelevanceTasks(
  db: Queryable,
  limit: number
): Promise<RelevanceTaskRecord[]> {
  const result = await db.query<{
    id: string;
    target_id: string;
    result: { results?: Array<{ cveId: string; relevance: string; evidence: string }> } | null;
    completed_at: Date | null;
  }>(
    `
      SELECT id, target_id, result, completed_at
      FROM analysis_tasks
      WHERE task_name = $1 AND status = 'completed'
      ORDER BY completed_at ASC NULLS LAST, id ASC
      LIMIT $2
    `,
    [RELEVANCE_TASK_NAME, limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    targetId: row.target_id,
    result: row.result,
    completedAt: row.completed_at,
  }));
}
