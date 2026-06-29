import type { ArticleRecord } from '../db/repositories/article.repository.js';
import { ArticleRepository } from '../db/repositories/article.repository.js';

export type DedupDecisionType =
  | 'unique'
  | 'exact_duplicate'
  | 'title_near_duplicate'
  | 'semantic_candidate';

export interface DedupDecision {
  type: DedupDecisionType;
  duplicateOfArticleId?: string;
  reason: string;
  semanticCandidates: Array<ArticleRecord & { distance: number }>;
}

export async function classifyArticleDedup(
  article: ArticleRecord,
  articles: ArticleRepository,
  options: {
    semanticVector?: number[];
    titleWindowDays?: number;
    semanticLimit?: number;
    semanticDaysBack?: number;
    semanticDistanceThreshold?: number;
  } = {}
): Promise<DedupDecision> {
  if (article.contentHash) {
    const exact = await articles.findEarlierByContentHash(article.contentHash, article.id);
    if (exact) {
      return {
        type: 'exact_duplicate',
        duplicateOfArticleId: exact.id,
        reason: 'matching_content_hash',
        semanticCandidates: [],
      };
    }
  }

  if (article.titleHash) {
    const titleDuplicate = await articles.findRecentByTitleHash(article.titleHash, {
      excludeArticleId: article.id,
      daysBack: options.titleWindowDays ?? 7,
    });
    if (titleDuplicate) {
      return {
        type: 'title_near_duplicate',
        duplicateOfArticleId: titleDuplicate.id,
        reason: 'matching_title_hash_within_window',
        semanticCandidates: [],
      };
    }
  }

  const semanticCandidates = options.semanticVector
    ? (
        await articles.findSimilarArticles(options.semanticVector, {
          limit: options.semanticLimit ?? 5,
          daysBack: options.semanticDaysBack ?? 14,
          excludeArticleId: article.id,
        })
      ).filter((candidate) => candidate.distance <= (options.semanticDistanceThreshold ?? 0.18))
    : [];

  if (semanticCandidates.length > 0) {
    return {
      type: 'semantic_candidate',
      reason: 'semantic_similarity_candidate',
      semanticCandidates,
    };
  }

  return {
    type: 'unique',
    reason: 'no_duplicate_signal',
    semanticCandidates: [],
  };
}
