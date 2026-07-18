import { AnalysisTaskRepository } from '../db/repositories/analysis-task.repository.js';
import { ArticleRepository } from '../db/repositories/article.repository.js';
import { CveCaseRepository } from '../db/repositories/cve-case.repository.js';
import type { Queryable } from '../db/repositories/types.js';

/**
 * Workspace read for Story 29: uncertain article–CVE relationships queued for human review.
 *
 * Uncertain pairs never create a CVE case (Story 28), so they live only inside the completed
 * `article_cve_relevance` task result. This queue surfaces every uncertain (article, CVE) pair
 * that has not yet been promoted into a case (i.e. no cve_case_articles row exists for it).
 */

export interface UncertainRelationshipEntry {
  articleId: string;
  cveId: string;
  evidence: string;
  automatedTaskId: string;
  automatedAt: string | null;
  article: {
    title: string | null;
    sourceName: string | null;
    canonicalUrl: string | null;
  };
}

interface RelevanceTaskResult {
  results?: Array<{ cveId: string; relevance: string; evidence: string }>;
}

export async function listUncertainRelationshipQueue(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<UncertainRelationshipEntry[]> {
  const limit = options.limit ?? 100;
  const tasks = new AnalysisTaskRepository(db);
  const caseRepo = new CveCaseRepository(db);
  const articleRepo = new ArticleRepository(db);

  const completed = await tasks.listCompletedByName('article_cve_relevance', limit * 4);

  const pairs: Array<{ articleId: string; cveId: string; evidence: string; taskId: string; automatedAt: string | null }> = [];
  const seen = new Set<string>();
  for (const task of completed) {
    const results = (task.result as RelevanceTaskResult | null)?.results ?? [];
    for (const item of results) {
      if (item.relevance !== 'uncertain') continue;
      const key = `${task.targetId}:${item.cveId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({
        articleId: task.targetId,
        cveId: item.cveId,
        evidence: item.evidence,
        taskId: task.id,
        automatedAt: task.completedAt?.toISOString() ?? null,
      });
    }
  }
  if (pairs.length === 0) return [];

  const cveIds = Array.from(new Set(pairs.map((p) => p.cveId)));
  const caseIdByCve = await caseRepo.listCaseIdsForCves(cveIds);
  const promotedArticlesByCve = new Map<string, Set<string>>();
  for (const [cveId, caseId] of caseIdByCve) {
    const rows = await caseRepo.listCaseArticlesByCase(caseId);
    promotedArticlesByCve.set(cveId, new Set(rows.map((r) => r.articleId)));
  }

  const pending = pairs.filter((p) => !promotedArticlesByCve.get(p.cveId)?.has(p.articleId));
  if (pending.length === 0) return [];

  const articleIds = Array.from(new Set(pending.map((p) => p.articleId)));
  const articleRecords = await articleRepo.findByIds(articleIds);
  const articleById = new Map(articleRecords.map((a) => [a.id, a]));

  return pending.slice(0, limit).map((p) => {
    const article = articleById.get(p.articleId);
    return {
      articleId: p.articleId,
      cveId: p.cveId,
      evidence: p.evidence,
      automatedTaskId: p.taskId,
      automatedAt: p.automatedAt,
      article: {
        title: article?.title ?? null,
        sourceName: article?.sourceName ?? null,
        canonicalUrl: article?.canonicalUrl ?? null,
      },
    };
  });
}
