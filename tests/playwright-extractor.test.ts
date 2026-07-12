import { describe, expect, it } from 'vitest';
import { PlaywrightArticleExtractor } from '../src/extraction/playwright-article-extractor.js';

// Optional live Chromium check; skipped in CI unless PLAYWRIGHT_LIVE=1.
describe.skipIf(!process.env.PLAYWRIGHT_LIVE)('PlaywrightArticleExtractor', () => {
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
