import { describe, expect, it } from 'vitest';
import type { ArticleExtractor } from '../src/extraction/article-extractor.interface.js';
import { htmlToText } from '../src/extraction/content-cleaner.js';
import { ExtractionRouter } from '../src/extraction/extraction-router.js';

describe('content cleaner', () => {
  it('removes scripts, tags, and collapses whitespace', () => {
    expect(htmlToText('<article><h1>Title</h1><script>x()</script><p>A&nbsp;test.</p></article>')).toBe(
      'Title A test.'
    );
  });
});

describe('ExtractionRouter', () => {
  it('uses long RSS summaries before HTTP extraction', async () => {
    const http: ArticleExtractor = {
      async extract() {
        throw new Error('should not be called');
      },
    };
    const router = new ExtractionRouter({ minRssSummaryLength: 10, httpExtractor: http });

    const result = await router.extract({
      url: 'https://example.test/article',
      rssSummary: 'This summary is long enough.',
    });

    expect(result.status).toBe('rss_only');
    expect(result.cleanText).toBe('This summary is long enough.');
  });

  it('routes failed HTTP extraction to fallback extractor', async () => {
    const http: ArticleExtractor = {
      async extract() {
        return {
          cleanText: 'short',
          method: 'http',
          status: 'http_failed',
          error: 'too short',
        };
      },
    };
    const fallback: ArticleExtractor = {
      async extract() {
        return {
          cleanText: 'fallback article text',
          method: 'playwright',
          status: 'playwright_success',
        };
      },
    };
    const router = new ExtractionRouter({ httpExtractor: http, fallbackExtractor: fallback });

    const result = await router.extract({ url: 'https://example.test/article' });

    expect(result.status).toBe('playwright_success');
    expect(result.cleanText).toBe('fallback article text');
  });
});
