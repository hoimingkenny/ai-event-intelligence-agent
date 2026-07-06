import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import { loadArticlesOverview, loadArticleDetail } from '../src/portal/articles-portal.js';
import { escapeHtml } from '../src/portal/articles-portal-server.js';
import { renderPortalApp } from '../src/portal/articles-portal-view.js';

/**
 * A scripted DB that answers each SQL shape the portal issues. Matching is by
 * substring so the tests assert the queries the portal actually runs.
 */
function scriptedDb(handlers: Array<{ match: string; rows: unknown[] }>): Queryable {
  return {
    async query<T>(sql: string) {
      const handler = handlers.find((h) => sql.includes(h.match));
      return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows.length ?? 0 };
    },
  } as Queryable;
}

describe('loadArticlesOverview', () => {
  it('returns list items, summary, and filter option lists', async () => {
    const db = scriptedDb([
      {
        match: 'FROM articles\n      \n      ORDER BY', // list query (no filters → empty where)
        rows: [
          {
            id: '1',
            title: 'CyberArk exploited',
            source_name: 'Test',
            canonical_url: 'https://x/1',
            processing_status: 'CLASSIFIED',
            extraction_status: 'http_success',
            extraction_method: 'http',
            content_quality_score: '0.82',
            rss_recall: '0.9',
            clean_text_length: 1200,
            published_at: new Date('2026-07-05T00:00:00Z'),
            fetched_at: new Date('2026-07-05T00:05:00Z'),
            extracted_at: new Date('2026-07-05T00:06:00Z'),
          },
        ],
      },
      { match: 'SELECT count(*) AS count', rows: [{ count: '1' }] },
      { match: 'processing_status, count(*)', rows: [{ processing_status: 'CLASSIFIED', count: '1' }] },
      { match: 'percentile_cont', rows: [{ median_recall: '0.9', median_quality: '0.82' }] },
      { match: 'DISTINCT source_name', rows: [{ value: 'Test' }] },
      { match: 'DISTINCT processing_status', rows: [{ value: 'CLASSIFIED' }] },
    ]);

    const overview = await loadArticlesOverview(db, {});

    expect(overview.items).toHaveLength(1);
    expect(overview.items[0]).toMatchObject({ id: '1', contentQualityScore: 0.82, rssRecall: 0.9, cleanTextLength: 1200 });
    expect(overview.summary).toMatchObject({ total: 1, medianQuality: 0.82, extractionFailureRate: 0 });
    expect(overview.sources).toEqual(['Test']);
    expect(overview.statuses).toEqual(['CLASSIFIED']);
  });

  it('computes extraction failure rate from FAIL statuses', async () => {
    const db = scriptedDb([
      { match: 'ORDER BY', rows: [] },
      { match: 'SELECT count(*) AS count', rows: [{ count: '0' }] },
      {
        match: 'processing_status, count(*)',
        rows: [
          { processing_status: 'CLASSIFIED', count: '8' },
          { processing_status: 'EXTRACTION_FAILED', count: '2' },
        ],
      },
      { match: 'percentile_cont', rows: [{ median_recall: null, median_quality: null }] },
      { match: 'DISTINCT source_name', rows: [] },
      { match: 'DISTINCT processing_status', rows: [] },
    ]);

    const overview = await loadArticlesOverview(db, {});
    expect(overview.summary.total).toBe(10);
    expect(overview.summary.extractionFailureRate).toBeCloseTo(0.2, 5);
    expect(overview.summary.medianRssRecall).toBeNull();
  });
});

describe('loadArticleDetail', () => {
  it('assembles article + entities + events + alerts, coercing numerics', async () => {
    const db = scriptedDb([
      {
        match: 'FROM articles\n      WHERE id = $1',
        rows: [
          {
            id: '5',
            title: 'SailPoint advisory',
            source_name: 'Test',
            canonical_url: 'https://x/5',
            processing_status: 'GROUPED',
            extraction_status: 'http_success',
            extraction_method: 'http',
            content_quality_score: '0.7',
            rss_recall: '0.88',
            clean_text_length: 900,
            published_at: null,
            fetched_at: new Date('2026-07-05T00:00:00Z'),
            extracted_at: null,
            rss_summary: 'summary',
            clean_text: 'body',
            extraction_error: null,
            llm_classification: { cyberRelevant: true },
          },
        ],
      },
      { match: 'FROM article_entities', rows: [{ entity_type: 'vendor', entity_value: 'SailPoint', confidence: '0.9', role: 'affected' }] },
      { match: 'FROM event_articles ea JOIN cyber_events', rows: [{ event_id: '10', event_title: 'E', relationship: 'same_event_new_source', severity: 'high', confidence: '0.8' }] },
      { match: 'FROM alerts a JOIN event_articles', rows: [{ alert_tier: 'confirmed', alert_status: 'sent', alert_reason: 'r', suppressed: false }] },
    ]);

    const detail = await loadArticleDetail(db, '5');
    expect(detail?.entities[0]).toMatchObject({ entityValue: 'SailPoint', confidence: 0.9 });
    expect(detail?.events[0]).toMatchObject({ eventId: '10', confidence: 0.8 });
    expect(detail?.alerts[0]).toMatchObject({ alertTier: 'confirmed', suppressed: false });
    expect(detail?.llmClassification).toEqual({ cyberRelevant: true });
  });

  it('returns null for a missing article', async () => {
    const db = scriptedDb([{ match: 'FROM articles\n      WHERE id = $1', rows: [] }]);
    expect(await loadArticleDetail(db, '999')).toBeNull();
  });
});

describe('escapeHtml + portal shell', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml('<script>"&"</script>')).toBe('&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;');
  });

  it('renders a self-contained portal shell with the API wiring', () => {
    const html = renderPortalApp();
    expect(html).toContain('/api/articles');
    expect(html).toContain('sandbox=""'); // extracted preview is sandboxed
    expect(html).toContain('Article Portal');
  });
});
