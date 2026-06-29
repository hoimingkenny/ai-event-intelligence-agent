import { ArticleRepository } from '../db/repositories/article.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { classifyArticleDedup } from '../dedup/article-dedup.js';

export interface DedupStageResult {
  reviewed: number;
  exactDuplicates: number;
  titleDuplicates: number;
  semanticCandidates: number;
  unique: number;
}

export async function runDedupStage(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<DedupStageResult> {
  const articles = new ArticleRepository(db);
  const candidates = [
    ...(await articles.listByProcessingStatus('EXTRACTED', options.limit ?? 20)),
    ...(await articles.listByProcessingStatus('ENTITY_EXTRACTED', options.limit ?? 20)),
    ...(await articles.listByProcessingStatus('EMBEDDED', options.limit ?? 20)),
  ].slice(0, options.limit ?? 20);
  let exactDuplicates = 0;
  let titleDuplicates = 0;
  let semanticCandidates = 0;
  let unique = 0;

  for (const article of candidates) {
    const decision = await classifyArticleDedup(article, articles);
    if (decision.type === 'exact_duplicate' && decision.duplicateOfArticleId) {
      await articles.markDuplicate(article.id, decision.duplicateOfArticleId, decision.reason);
      exactDuplicates += 1;
      continue;
    }

    if (decision.type === 'title_near_duplicate' && decision.duplicateOfArticleId) {
      await articles.markDuplicate(article.id, decision.duplicateOfArticleId, decision.reason);
      titleDuplicates += 1;
      continue;
    }

    if (decision.type === 'semantic_candidate') {
      semanticCandidates += 1;
    } else {
      unique += 1;
    }
  }

  return {
    reviewed: candidates.length,
    exactDuplicates,
    titleDuplicates,
    semanticCandidates,
    unique,
  };
}
