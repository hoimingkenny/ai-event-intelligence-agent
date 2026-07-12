import type {
  ArticleExtractionInput,
  ArticleExtractionResult,
  ArticleExtractor,
} from './article-extractor.interface.js';
import { HttpArticleExtractor, isHttpBlockError } from './http-article-extractor.js';
import { PlaywrightArticleExtractor } from './playwright-article-extractor.js';

export interface ExtractionRouterOptions {
  minRssSummaryLength?: number;
  httpExtractor?: ArticleExtractor;
  /** When omitted, Playwright is used after HTTP 403/429. Pass `null` to disable. */
  fallbackExtractor?: ArticleExtractor | null;
}

export class ExtractionRouter implements ArticleExtractor {
  private readonly minRssSummaryLength: number;
  private readonly httpExtractor: ArticleExtractor;
  private readonly fallbackExtractor: ArticleExtractor | null;

  constructor(options: ExtractionRouterOptions = {}) {
    this.minRssSummaryLength = options.minRssSummaryLength ?? 500;
    this.httpExtractor = options.httpExtractor ?? new HttpArticleExtractor();
    this.fallbackExtractor =
      options.fallbackExtractor === undefined
        ? new PlaywrightArticleExtractor()
        : options.fallbackExtractor;
  }

  async extract(input: ArticleExtractionInput): Promise<ArticleExtractionResult> {
    if (input.rssSummary && input.rssSummary.length >= this.minRssSummaryLength) {
      return {
        cleanText: input.rssSummary,
        method: 'rss_summary',
        status: 'rss_only',
      };
    }

    const http = await this.httpExtractor.extract(input);
    if (http.status === 'http_success') return http;

    // Playwright only for WAF/rate blocks — not for short/noisy HTTP bodies.
    if (!this.fallbackExtractor || !isHttpBlockError(http.error)) return http;

    const fallback = await this.fallbackExtractor.extract(input);
    if (fallback.status === 'playwright_success') return fallback;

    return {
      cleanText: http.cleanText ?? fallback.cleanText,
      rawHtml: http.rawHtml,
      method: fallback.method,
      status: fallback.status,
      error: fallback.error ?? http.error,
    };
  }
}
