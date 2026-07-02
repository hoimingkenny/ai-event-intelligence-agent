import type {
  ArticleExtractionInput,
  ArticleExtractionResult,
  ArticleExtractor,
} from './article-extractor.interface.js';
import { contentQualityScore, htmlToText } from './content-cleaner.js';
import { extractReadableContent } from './readable-content.js';

export class HttpArticleExtractor implements ArticleExtractor {
  constructor(private readonly minTextLength = 250) {}

  async extract(input: ArticleExtractionInput): Promise<ArticleExtractionResult> {
    try {
      const response = await fetch(input.url, {
        headers: {
          'user-agent': 'vendor-threat-watch/0.1 (+https://example.local)',
        },
      });

      if (!response.ok) {
        return {
          cleanText: null,
          method: 'http',
          status: 'http_failed',
          error: `HTTP ${response.status}`,
        };
      }

      const rawHtml = await response.text();
      // Per-source selector → Readability → regex strip as last resort.
      const readable = extractReadableContent(rawHtml, input.url);
      const cleanText = readable.cleanText ?? htmlToText(rawHtml);
      const score = contentQualityScore(cleanText);
      if (cleanText.length < this.minTextLength || score <= 0) {
        return {
          cleanText,
          rawHtml,
          method: 'http',
          status: 'http_failed',
          error: `extracted text too short: ${cleanText.length}`,
        };
      }

      return {
        cleanText,
        rawHtml,
        method: 'http',
        status: 'http_success',
      };
    } catch (error) {
      return {
        cleanText: null,
        method: 'http',
        status: 'http_failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
