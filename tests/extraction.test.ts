import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArticleExtractor } from '../src/extraction/article-extractor.interface.js';
import { htmlToText } from '../src/extraction/content-cleaner.js';
import { ExtractionRouter } from '../src/extraction/extraction-router.js';
import {
  HTTP_ARTICLE_FETCH_HEADERS,
  HttpArticleExtractor,
} from '../src/extraction/http-article-extractor.js';

describe('content cleaner', () => {
  it('removes scripts, tags, and collapses whitespace', () => {
    expect(htmlToText('<article><h1>Title</h1><script>x()</script><p>A&nbsp;test.</p></article>')).toBe(
      'Title A test.'
    );
  });
});

describe('HttpArticleExtractor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends browser-like User-Agent and Accept headers', async () => {
    const html = `<!doctype html><html><body><article>${'paragraph text '.repeat(40)}</article></body></html>`;
    const fetchMock = vi.fn(async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new HttpArticleExtractor().extract({
      url: 'https://www.securityweek.com/example/',
      title: 'Example',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      headers: { ...HTTP_ARTICLE_FETCH_HEADERS },
    });
    expect(result.status).toBe('http_success');
  });

  it('retries HTTP 403 then succeeds', async () => {
    const html = `<!doctype html><html><body><article>${'paragraph text '.repeat(40)}</article></body></html>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const sleep = vi.fn(async () => undefined);
    const result = await new HttpArticleExtractor({ sleep, retryBackoffMs: 1 }).extract({
      url: 'https://www.securityweek.com/example/',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(result.status).toBe('http_success');
  });

  it('exhausts retries on persistent HTTP 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Forbidden', { status: 403 }))
    );

    const result = await new HttpArticleExtractor({
      maxAttempts: 2,
      sleep: async () => undefined,
    }).extract({
      url: 'https://www.securityweek.com/example/',
    });

    expect(result.status).toBe('http_failed');
    expect(result.error).toBe('HTTP 403');
  });

  it('does not retry non-block HTTP failures', async () => {
    const fetchMock = vi.fn(async () => new Response('Nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new HttpArticleExtractor({
      sleep: async () => undefined,
    }).extract({ url: 'https://example.test/x' });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.error).toBe('HTTP 500');
  });
});

describe('ExtractionRouter', () => {
  it('uses long RSS summaries before HTTP extraction', async () => {
    const http: ArticleExtractor = {
      async extract() {
        throw new Error('should not be called');
      },
    };
    const router = new ExtractionRouter({
      minRssSummaryLength: 10,
      httpExtractor: http,
      fallbackExtractor: null,
    });

    const result = await router.extract({
      url: 'https://example.test/article',
      rssSummary: 'This summary is long enough.',
    });

    expect(result.status).toBe('rss_only');
    expect(result.cleanText).toBe('This summary is long enough.');
  });

  it('routes HTTP 403 to Playwright fallback after HTTP failure', async () => {
    const http: ArticleExtractor = {
      async extract() {
        return {
          cleanText: null,
          method: 'http',
          status: 'http_failed',
          error: 'HTTP 403',
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

  it('does not escalate short-body HTTP failures to Playwright', async () => {
    const fallback = {
      extract: vi.fn(async () => {
        throw new Error('should not be called');
      }),
    };
    const http: ArticleExtractor = {
      async extract() {
        return {
          cleanText: 'short',
          method: 'http',
          status: 'http_failed',
          error: 'extracted text too short: 5',
        };
      },
    };
    const router = new ExtractionRouter({ httpExtractor: http, fallbackExtractor: fallback });

    const result = await router.extract({ url: 'https://example.test/article' });

    expect(result.status).toBe('http_failed');
    expect(fallback.extract).not.toHaveBeenCalled();
  });
});
