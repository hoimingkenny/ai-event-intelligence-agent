import type {
  ArticleExtractionInput,
  ArticleExtractionResult,
  ArticleExtractor,
} from './article-extractor.interface.js';
import { contentQualityScore, htmlToText } from './content-cleaner.js';
import { extractReadableContent } from './readable-content.js';

/** Browser-like headers; bot UAs get intermittent 403s from some publishers/WAFs. */
export const HTTP_ARTICLE_FETCH_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml',
} as const;

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_BACKOFF_MS = 500;

export interface HttpArticleExtractorOptions {
  minTextLength?: number;
  /** Total HTTP attempts for 403/429 (default 2). Other failures do not retry. */
  maxAttempts?: number;
  retryBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function isHttpBlockError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /^HTTP (403|429)\b/.test(error);
}

export class HttpArticleExtractor implements ArticleExtractor {
  private readonly minTextLength: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HttpArticleExtractorOptions | number = {}) {
    // Backward compat: `new HttpArticleExtractor(250)`.
    if (typeof options === 'number') {
      this.minTextLength = options;
      this.maxAttempts = DEFAULT_MAX_ATTEMPTS;
      this.retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS;
      this.sleep = defaultSleep;
      return;
    }
    this.minTextLength = options.minTextLength ?? 250;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async extract(input: ArticleExtractionInput): Promise<ArticleExtractionResult> {
    let lastBlockFailure: ArticleExtractionResult | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const result = await this.attemptOnce(input);
      if (result.status === 'http_success') return result;
      if (!isHttpBlockError(result.error)) return result;

      lastBlockFailure = result;
      if (attempt < this.maxAttempts) {
        await this.sleep(this.retryBackoffMs * attempt);
      }
    }

    return (
      lastBlockFailure ?? {
        cleanText: null,
        method: 'http',
        status: 'http_failed',
        error: 'HTTP block retries exhausted',
      }
    );
  }

  private async attemptOnce(input: ArticleExtractionInput): Promise<ArticleExtractionResult> {
    try {
      const response = await fetch(input.url, {
        headers: { ...HTTP_ARTICLE_FETCH_HEADERS },
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
