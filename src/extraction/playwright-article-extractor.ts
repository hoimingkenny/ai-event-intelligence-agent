import type {
  ArticleExtractionInput,
  ArticleExtractionResult,
  ArticleExtractor,
} from './article-extractor.interface.js';
import { env } from '../config/env.js';
import { contentQualityScore, htmlToText } from './content-cleaner.js';

type PlaywrightModule = typeof import('playwright');
type Browser = Awaited<ReturnType<PlaywrightModule['chromium']['launch']>>;

export interface PlaywrightArticleExtractorOptions {
  timeoutMs?: number;
  minTextLength?: number;
  userAgent?: string;
}

export class PlaywrightArticleExtractor implements ArticleExtractor {
  private browser: Browser | null = null;
  private readonly timeoutMs: number;
  private readonly minTextLength: number;
  private readonly userAgent: string;

  constructor(options: PlaywrightArticleExtractorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? env.playwrightExtractionTimeoutMs;
    this.minTextLength = options.minTextLength ?? env.playwrightMinTextLength;
    this.userAgent = options.userAgent ?? 'vendor-threat-watch/0.1 (+https://example.local)';
  }

  async extract(input: ArticleExtractionInput): Promise<ArticleExtractionResult> {
    try {
      const browser = await this.getBrowser();
      const context = await browser.newContext({
        javaScriptEnabled: true,
        userAgent: this.userAgent,
      });

      try {
        const page = await context.newPage();
        page.setDefaultTimeout(this.timeoutMs);
        page.setDefaultNavigationTimeout(this.timeoutMs);
        await page.goto(input.url, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeoutMs,
        });
        await page.waitForLoadState('networkidle', { timeout: Math.min(this.timeoutMs, 5000) }).catch(() => {
          /* Some pages keep long-polling connections open; body text is still usable. */
        });

        const rawHtml = await page.content();
        const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
        const cleanText = normalizeBrowserText(bodyText) || htmlToText(rawHtml);
        const score = contentQualityScore(cleanText);

        if (cleanText.length < this.minTextLength || score <= 0) {
          return {
            cleanText,
            rawHtml,
            method: 'playwright',
            status: 'playwright_failed',
            error: `extracted text too short: ${cleanText.length}`,
          };
        }

        return {
          cleanText,
          rawHtml,
          method: 'playwright',
          status: 'playwright_success',
        };
      } finally {
        await context.close();
      }
    } catch (error) {
      return {
        cleanText: null,
        method: 'playwright',
        status: 'playwright_failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async close(): Promise<void> {
    if (!this.browser) return;
    await this.browser.close();
    this.browser = null;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: true });
    return this.browser;
  }
}

function normalizeBrowserText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
