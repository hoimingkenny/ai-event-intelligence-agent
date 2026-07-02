import { describe, expect, it } from 'vitest';
import { PlaywrightArticleExtractor } from '../src/extraction/playwright-article-extractor.js';

// Playwright extraction path is disabled while we focus on HTTP + Readability quality.
describe.skip('PlaywrightArticleExtractor', () => {
  it('extracts text from a JavaScript-rendered page', async () => {
    const html = `
      <html>
        <body>
          <main id="app">Loading...</main>
          <script>
            document.getElementById('app').textContent =
              'JavaScript rendered article text with enough content for extraction.';
          </script>
        </body>
      </html>
    `;
    const extractor = new PlaywrightArticleExtractor({
      minTextLength: 20,
      timeoutMs: 5000,
    });

    try {
      const result = await extractor.extract({
        url: `data:text/html,${encodeURIComponent(html)}`,
      });

      if (
        result.status === 'playwright_failed' &&
        /Executable doesn't exist|browserType.launch/i.test(result.error ?? '')
      ) {
        return;
      }

      expect(result.status).toBe('playwright_success');
      expect(result.cleanText).toContain('JavaScript rendered article text');
    } finally {
      await extractor.close();
    }
  }, 15_000);
});
