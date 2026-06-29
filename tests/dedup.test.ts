import { describe, expect, it } from 'vitest';
import { classifyArticleDedup } from '../src/dedup/article-dedup.js';
import type { ArticleRecord } from '../src/db/repositories/article.repository.js';

const baseArticle: ArticleRecord = {
  id: '2',
  feedId: null,
  sourceName: 'Source',
  title: 'Vendor VPN exploited',
  canonicalUrl: 'https://example.test/new',
  urlHash: 'url-2',
  titleHash: 'title-1',
  contentHash: 'content-1',
  rssSummary: 'Summary',
  cleanText: 'Clean text',
  publishedAt: new Date('2026-06-01T00:00:00Z'),
  extractionStatus: 'http_success',
  extractionMethod: 'http',
  extractionError: null,
  processingStatus: 'EXTRACTED',
};

function makeArticle(overrides: Partial<ArticleRecord & { distance: number }> = {}): ArticleRecord & { distance?: number } {
  return { ...baseArticle, ...overrides };
}

describe('classifyArticleDedup', () => {
  it('marks exact content-hash duplicates before other matching', async () => {
    const decision = await classifyArticleDedup(makeArticle(), {
      findEarlierByContentHash: async () => makeArticle({ id: '1' }),
      findRecentByTitleHash: async () => null,
      findSimilarArticles: async () => [],
    } as never);

    expect(decision.type).toBe('exact_duplicate');
    expect(decision.duplicateOfArticleId).toBe('1');
  });

  it('marks title duplicates inside the recent window', async () => {
    const decision = await classifyArticleDedup(makeArticle({ contentHash: null }), {
      findEarlierByContentHash: async () => null,
      findRecentByTitleHash: async () => makeArticle({ id: '1' }),
      findSimilarArticles: async () => [],
    } as never);

    expect(decision.type).toBe('title_near_duplicate');
    expect(decision.duplicateOfArticleId).toBe('1');
  });

  it('returns semantic candidates without declaring a duplicate', async () => {
    const decision = await classifyArticleDedup(
      makeArticle({ contentHash: null, titleHash: null }),
      {
        findEarlierByContentHash: async () => null,
        findRecentByTitleHash: async () => null,
        findSimilarArticles: async () => [makeArticle({ id: '1', distance: 0.1 })],
      } as never,
      { semanticVector: [0.1, 0.2], semanticDistanceThreshold: 0.18 }
    );

    expect(decision.type).toBe('semantic_candidate');
    expect(decision.semanticCandidates.map((candidate) => candidate.id)).toEqual(['1']);
  });
});
