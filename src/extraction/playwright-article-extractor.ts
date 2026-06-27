import type {
  ArticleExtractionInput,
  ArticleExtractionResult,
  ArticleExtractor,
} from './article-extractor.interface.js';

/**
 * Placeholder fallback extractor for the modular pipeline.
 * A real Playwright-backed implementation can replace this without changing the router.
 */
export class UnavailablePlaywrightExtractor implements ArticleExtractor {
  async extract(_input: ArticleExtractionInput): Promise<ArticleExtractionResult> {
    return {
      cleanText: null,
      method: 'playwright',
      status: 'playwright_failed',
      error: 'Playwright fallback is not installed yet',
    };
  }
}
