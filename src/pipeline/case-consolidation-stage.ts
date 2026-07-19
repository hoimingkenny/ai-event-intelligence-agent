import { AnalysisTaskRepository } from '../db/repositories/analysis-task.repository.js';
import { CveCaseRepository } from '../db/repositories/cve-case.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import {
  buildEnrichmentAdapterSet,
  consolidateArticleCveEvidence,
  runInitialEnrichment,
  type AttachArticleInput,
} from '../cve/cases.js';
import type { EnrichmentAdapterSet } from '../cve/enrichment.js';
import { syncCasePublicationFromCvss } from '../cve/review.js';
import { logStageArticle, logStageBatch } from '../utils/logger.js';

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

const INTERPRETATION_TASK_NAME = 'article_cve_interpretation';

interface InterpretationTaskResult {
  results?: Array<{
    cveId: string;
    interpretation: string;
  }>;
}

export async function runCaseConsolidationStage(
  db: Queryable,
  options: CaseConsolidationStageOptions = {}
): Promise<CaseConsolidationStageResult> {
  const cases = new CveCaseRepository(db);
  const adapters = buildEnrichmentAdapterSet({ adapters: options.adapters });

  const evidenceInputs = await collectInterpretedEvidence(db, options.limit ?? 200);

  if (evidenceInputs.length === 0) {
    logStageBatch('case_consolidation', 'none', []);
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

  const articleIds = Array.from(new Set(evidenceInputs.map((item) => item.articleId)));
  logStageBatch('case_consolidation', 'consolidate', articleIds, {
    evidenceCount: evidenceInputs.length,
    cveIds: Array.from(new Set(evidenceInputs.map((item) => item.cveId))).sort(),
  });

  for (const item of evidenceInputs) {
    logStageArticle('case_consolidation', item.articleId, 'attach', {
      cveId: item.cveId,
      lifecycleState: item.lifecycleState,
    });
  }

  const consolidation = await consolidateArticleCveEvidence(db, evidenceInputs);

  const newCaseIds: string[] = [];
  for (const ensured of consolidation.cases) {
    const existingObservations = await cases.listCurrentObservations(ensured.id);
    if (existingObservations.size === 0) newCaseIds.push(ensured.id);
  }

  if (newCaseIds.length > 0) {
    logStageBatch('case_consolidation', 'enrich_scores', articleIds, {
      caseIds: newCaseIds,
      cveIds: consolidation.cases
        .filter((c) => newCaseIds.includes(c.id))
        .map((c) => c.cveId)
        .sort(),
    });
  }

  const enrichment = await runInitialEnrichment(db, newCaseIds, adapters);

  // Re-sync every case touched this run (covers already-enriched cases whose CVSS
  // already meets the auto-publish threshold).
  for (const ensured of consolidation.cases) {
    await syncCasePublicationFromCvss(db, ensured.id);
  }

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

/**
 * Collect article↔CVE pairs ready for case ensure + enrichment.
 *
 * Every CVE the interpretation task reported for an actionable article becomes a case-article
 * link in the neutral `mentioned` state, so each mention carries NVD/KEV/EPSS scores. Human
 * review (Confirm / Reject / Uncertain) is what later promotes a link to relevant evidence.
 */
async function collectInterpretedEvidence(
  db: Queryable,
  limit: number
): Promise<AttachArticleInput[]> {
  const tasks = new AnalysisTaskRepository(db);
  const queued: AttachArticleInput[] = [];
  const seen = new Set<string>();

  const completed = await tasks.listCompletedByName(INTERPRETATION_TASK_NAME, limit);
  for (const task of completed) {
    const results = (task.result as InterpretationTaskResult | null)?.results ?? [];
    for (const item of results) {
      const dedupeKey = `${task.targetId}:${item.cveId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      queued.push({
        cveId: item.cveId,
        articleId: task.targetId,
        lifecycleState: 'mentioned',
        evidence: {
          cveId: item.cveId,
          interpretation: item.interpretation,
          automatedAt: task.completedAt?.toISOString() ?? new Date().toISOString(),
          automatedTaskId: task.id,
        },
      });
    }
  }
  return queued;
}
