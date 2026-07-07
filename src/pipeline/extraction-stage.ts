import { ArticleRepository } from '../db/repositories/article.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { contentQualityScore } from '../extraction/content-cleaner.js';
import { ExtractionRouter } from '../extraction/extraction-router.js';
import type { ArticleExtractor } from '../extraction/article-extractor.interface.js';
import { sha256Hex } from '../utils/hash.js';
import { wordRecall } from '../utils/word-overlap.js';

export interface ExtractionStageResult {
  reviewed: number;
  succeeded: number;
  failed: number;
}

export async function runExtractionStage(
  db: Queryable,
  options: { limit?: number; extractor?: ArticleExtractor } = {}
): Promise<ExtractionStageResult> {
  const articles = new ArticleRepository(db);
  const candidates = await articles.listExtractionCandidates(options.limit ?? 20);
  const extractor = options.extractor ?? new ExtractionRouter();
  let succeeded = 0;
  let failed = 0;

  for (const article of candidates) {
    if (!article.canonicalUrl) {
      await articles.updateProcessingStatus(article.id, 'EXTRACTION_FAILED', 'missing canonical URL');
      failed += 1;
      continue;
    }

    const result = await extractor.extract({
      url: article.canonicalUrl,
      rssSummary: article.rssSummary,
    });
    const success = result.status === 'rss_only' || result.status === 'http_success' || result.status === 'playwright_success';
    // Ground truth: the RSS summary is drawn from the article body, so its
    // word recall against cleanText measures extraction quality for free.
    // Not meaningful when the summary itself was used as the content.
    const rssRecall =
      result.status !== 'rss_only' && article.rssSummary && result.cleanText
        ? wordRecall(article.rssSummary, result.cleanText)
        : null;

    await articles.saveExtractionResult({
      articleId: article.id,
      cleanText: result.cleanText,
      rawHtml: result.rawHtml ?? null,
      contentHash: result.cleanText ? sha256Hex(result.cleanText) : null,
      extractionStatus: result.status,
      extractionMethod: result.method,
      extractionError: result.error ?? null,
      processingStatus: success ? 'EXTRACTION_SUCCESS' : 'EXTRACTION_FAILED',
      contentQualityScore: contentQualityScore(result.cleanText),
      rssRecall,
    });

    if (success) succeeded += 1;
    else failed += 1;
  }

  return {
    reviewed: candidates.length,
    succeeded,
    failed,
  };
}
