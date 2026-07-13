import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import { loadArticlesOverview, loadArticleDetail, loadArticleCleanText } from '../src/portal/articles-portal.js';
import { escapeHtml } from '../src/portal/articles-portal-server.js';
import { renderPortalApp } from '../src/portal/articles-portal-view.js';

/**
 * A scripted DB that answers each SQL shape the portal issues. Matching is by
 * substring so the tests assert the queries the portal actually runs.
 */
function scriptedDb(handlers: Array<{ match: string; rows: unknown[]; onQuery?: (sql: string) => void }>): Queryable {
  return {
    async query<T>(sql: string) {
      const handler = handlers.find((h) => sql.includes(h.match));
      handler?.onQuery?.(sql);
      return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows.length ?? 0 };
    },
  } as Queryable;
}

describe('loadArticlesOverview', () => {
  it('returns list items, summary, and filter option lists', async () => {
    const db = scriptedDb([
      {
        match: 'OFFSET', // list query (only the paginated list uses OFFSET)
        rows: [
          {
            id: '1',
            title: 'CyberArk exploited',
            source_name: 'Test',
            canonical_url: 'https://x/1',
            processing_status: 'CLASSIFIED',
            cheap_filter_decision: 'KEEP',
            extraction_status: 'http_success',
            extraction_method: 'http',
            content_quality_score: '0.82',
            rss_recall: '0.9',
            clean_text_length: 1200,
            published_at: new Date('2026-07-05T00:00:00Z'),
            fetched_at: new Date('2026-07-05T00:05:00Z'),
            extracted_at: new Date('2026-07-05T00:06:00Z'),
            top_vendor: 'CyberArk',
            vendor_relevance: '0.91',
          },
        ],
      },
      { match: 'SELECT count(*) AS count', rows: [{ count: '1' }] },
      { match: 'processing_status, count(*)', rows: [{ processing_status: 'CLASSIFIED', count: '1' }] },
      { match: 'percentile_cont', rows: [{ median_recall: '0.9', median_quality: '0.82' }] },
      { match: 'DISTINCT source_name', rows: [{ value: 'Test' }] },
      { match: 'DISTINCT processing_status', rows: [{ value: 'CLASSIFIED' }] },
      { match: 'DISTINCT cheap_filter_decision', rows: [{ value: 'KEEP' }] },
    ]);

    const overview = await loadArticlesOverview(db, {});

    expect(overview.items).toHaveLength(1);
    expect(overview.items[0]).toMatchObject({ id: '1', cheapFilterDecision: 'KEEP', contentQualityScore: 0.82, rssRecall: 0.9, cleanTextLength: 1200, topVendor: 'CyberArk', vendorRelevance: 0.91 });
    expect(overview.summary).toMatchObject({ total: 1, medianQuality: 0.82, extractionFailureRate: 0 });
    expect(overview.sources).toEqual(['Test']);
    expect(overview.statuses).toEqual(['CLASSIFIED']);
    expect(overview.cheapFilterDecisions).toEqual(['KEEP']);
  });

  it('applies the cheap filter decision filter', async () => {
    let listSql = '';
    const db = scriptedDb([
      {
        match: 'OFFSET',
        rows: [],
      },
      { match: 'SELECT count(*) AS count', rows: [{ count: '0' }] },
      { match: 'processing_status, count(*)', rows: [] },
      { match: 'percentile_cont', rows: [{ median_recall: null, median_quality: null }] },
      { match: 'DISTINCT source_name', rows: [] },
      { match: 'DISTINCT processing_status', rows: [] },
      { match: 'DISTINCT cheap_filter_decision', rows: [] },
    ]);
    const originalQuery = db.query.bind(db);
    db.query = async (sql: string, params?: unknown[]) => {
      if (sql.includes('OFFSET')) {
        listSql = sql;
        expect(params?.[0]).toBe('DROP');
      }
      return originalQuery(sql, params);
    };

    await loadArticlesOverview(db, { cheapFilterDecision: 'DROP' });
    expect(listSql).toContain('a.cheap_filter_decision = $1');
  });

  it('computes extraction failure rate from FAIL statuses', async () => {
    const db = scriptedDb([
      { match: 'OFFSET', rows: [] },
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

  it('only lists articles attached to at least one approved event', async () => {
    let listSql = '';
    let countSql = '';
    const db = scriptedDb([
      { match: 'OFFSET', rows: [], onQuery: (sql) => { listSql = sql; } },
      { match: 'SELECT count(*) AS count', rows: [{ count: '0' }], onQuery: (sql) => { countSql = sql; } },
      { match: 'processing_status, count(*)', rows: [] },
      { match: 'percentile_cont', rows: [{ median_recall: null, median_quality: null }] },
      { match: 'DISTINCT source_name', rows: [] },
      { match: 'DISTINCT processing_status', rows: [] },
      { match: 'DISTINCT cheap_filter_decision', rows: [] },
    ]);

    await loadArticlesOverview(db, {});

    for (const sql of [listSql, countSql]) {
      expect(sql).toContain('event_articles');
      expect(sql).toContain("publication_status = 'approved'");
      expect(sql).toContain('cardinality(coalesce(e.affected_vendors');
    }
  });
});

describe('loadArticleDetail', () => {
  it('assembles article + entities + events + alerts, coercing numerics', async () => {
    let eventsSql = '';
    const db = scriptedDb([
      {
        match: 'WHERE a.id = $1',
        rows: [
          {
            id: '5',
            title: 'SailPoint advisory',
            source_name: 'Test',
            canonical_url: 'https://x/5',
            processing_status: 'GROUPED',
            cheap_filter_decision: 'MAYBE_KEEP',
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
            top_vendor: 'SailPoint',
            vendor_relevance: '0.9',
          },
        ],
      },
      { match: 'FROM article_entities', rows: [{ entity_type: 'vendor', entity_value: 'SailPoint', confidence: '0.9', role: 'affected' }] },
      {
        match: 'FROM event_articles ea JOIN cyber_events',
        rows: [{ event_id: '10', event_title: 'LLM event title', relationship: 'same_event_new_source', severity: 'high', confidence: '0.8' }],
        onQuery: (sql) => { eventsSql = sql; },
      },
      { match: 'FROM alerts a', rows: [{ alert_tier: 'confirmed', alert_status: 'sent', alert_reason: 'r', suppressed: false }] },
    ]);

    const detail = await loadArticleDetail(db, '5');
    expect(detail).toMatchObject({ topVendor: 'SailPoint', vendorRelevance: 0.9, cheapFilterDecision: 'MAYBE_KEEP' });
    expect(detail?.entities[0]).toMatchObject({ entityValue: 'SailPoint', confidence: 0.9 });
    expect(detail?.events[0]).toMatchObject({ eventId: '10', confidence: 0.8 });
    expect(eventsSql).toContain('e.event_title');
    expect(eventsSql).toContain("e.publication_status = 'approved'");
    expect(eventsSql).toContain('cardinality(coalesce(e.affected_vendors');
    expect(eventsSql).not.toContain("e.llm_summary ->> 'title' AS event_title");
    expect(detail?.alerts[0]).toMatchObject({ alertTier: 'confirmed', suppressed: false });
    expect(detail?.llmClassification).toEqual({ cyberRelevant: true });
  });

  it('returns null for a missing article', async () => {
    const db = scriptedDb([{ match: 'WHERE a.id = $1', rows: [] }]);
    expect(await loadArticleDetail(db, '999')).toBeNull();
  });

  it('does not load articles that lack an approved event', async () => {
    let detailSql = '';
    const db = scriptedDb([
      {
        match: 'WHERE a.id = $1',
        rows: [],
        onQuery: (sql) => {
          detailSql = sql;
        },
      },
    ]);

    expect(await loadArticleDetail(db, '5')).toBeNull();
    expect(detailSql).toContain('event_articles');
    expect(detailSql).toContain("publication_status = 'approved'");
    expect(detailSql).toContain('cardinality(coalesce(e.affected_vendors');
  });
});

describe('loadArticleCleanText', () => {
  it('only previews articles attached to an approved event', async () => {
    let previewSql = '';
    const db = scriptedDb([
      {
        match: 'clean_text',
        rows: [],
        onQuery: (sql) => {
          previewSql = sql;
        },
      },
    ]);

    expect(await loadArticleCleanText(db, '5')).toBeNull();
    expect(previewSql).toContain('event_articles');
    expect(previewSql).toContain("publication_status = 'approved'");
    expect(previewSql).toContain('cardinality(coalesce(e.affected_vendors');
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
    expect(html).toContain('Vendor (closest)'); // vendor relevance column
    expect(html).toContain('Cheap filter'); // cheap-filter decision column/filter
    expect(html).toContain('vendor_desc'); // sort by vendor relevance
  });
});
