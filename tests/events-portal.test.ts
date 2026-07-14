import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import { loadEventsOverview, loadEventDetail } from '../src/portal/events-portal.js';

function scriptedDb(handlers: Array<{ match: string; rows: unknown[]; onQuery?: (sql: string) => void }>): Queryable {
  return {
    async query<T>(sql: string) {
      const handler = handlers.find((h) => sql.includes(h.match));
      handler?.onQuery?.(sql);
      return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows.length ?? 0 };
    },
  } as Queryable;
}

describe('loadEventsOverview', () => {
  it('lists events with source counts and a multi-source summary', async () => {
    let listSql = '';
    let filteredSql = '';
    let totalSql = '';
    let severitySql = '';
    const db = scriptedDb([
      {
        match: 'OFFSET',
        onQuery: (sql) => {
          listSql = sql;
        },
        rows: [
          {
            id: '10',
            event_title: 'CyberArk exploited',
            severity: 'high',
            urgency: 'P1',
            confidence: '0.82',
            source_count: 3,
            affected_vendors: ['CyberArk'],
            affected_products: ['PAM'],
            has_llm_summary: true,
            first_seen_at: new Date('2026-06-30T22:00:00Z'),
            last_seen_at: new Date('2026-07-01T13:10:00Z'),
          },
        ],
      },
      { match: 'SELECT count(*) AS count', rows: [{ count: '1' }], onQuery: (sql) => { filteredSql = sql; } },
      { match: 'FILTER (WHERE source_count > 1)', rows: [{ total: '5', multi_source: '2' }], onQuery: (sql) => { totalSql = sql; } },
      { match: 'GROUP BY severity', rows: [{ severity: 'high', count: '3' }, { severity: 'low', count: '2' }], onQuery: (sql) => { severitySql = sql; } },
    ]);

    const overview = await loadEventsOverview(db, {});
    expect(overview.items[0]).toMatchObject({
      id: '10',
      sourceCount: 3,
      confidence: 0.82,
      affectedVendors: ['CyberArk'],
      affectedProducts: ['PAM'],
      hasLlmSummary: true,
    });
    expect(overview.items[0].firstSeenAt?.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(overview.items[0].lastSeenAt?.toISOString()).toBe('2026-07-01T13:10:00.000Z');
    expect(listSql).toContain('min(a.published_at)');
    expect(listSql).toContain('max(a.published_at)');
    expect(listSql).toContain('SELECT e.id, e.event_title');
    expect(listSql).not.toContain("e.llm_summary ->> 'title' AS event_title");
    expect(listSql).not.toContain('e.llm_summary IS NOT NULL AND');
    expect(listSql).toContain("ORDER BY e.llm_summary IS NOT NULL DESC, array_position(ARRAY['critical','high','medium','low'], severity), confidence DESC NULLS LAST");
    expect(listSql).toContain("e.publication_status = 'approved'");
    expect(listSql).not.toContain('cardinality(coalesce(e.affected_vendors');
    expect(filteredSql).not.toContain('e.llm_summary IS NOT NULL AND');
    expect(filteredSql).toContain("e.publication_status = 'approved'");
    expect(filteredSql).not.toContain('cardinality(coalesce(e.affected_vendors');
    expect(totalSql).not.toContain('e.llm_summary IS NOT NULL AND');
    expect(totalSql).toContain("e.publication_status = 'approved'");
    expect(totalSql).not.toContain('cardinality(coalesce(e.affected_vendors');
    expect(severitySql).not.toContain('e.llm_summary IS NOT NULL AND');
    expect(severitySql).toContain("e.publication_status = 'approved'");
    expect(severitySql).not.toContain('cardinality(coalesce(e.affected_vendors');
    expect(overview.summary).toMatchObject({ total: 5, multiSource: 2 });
    expect(overview.summary.bySeverity).toEqual({ high: 3, low: 2 });
  });

  it('searches the event title and summary', async () => {
    let listSql = '';
    const db = scriptedDb([
      { match: 'OFFSET', rows: [], onQuery: (sql) => { listSql = sql; } },
      { match: 'SELECT count(*) AS count', rows: [{ count: '0' }] },
      { match: 'FILTER (WHERE source_count > 1)', rows: [{ total: '0', multi_source: '0' }] },
      { match: 'GROUP BY severity', rows: [] },
    ]);

    await loadEventsOverview(db, { search: 'sharepoint' });

    expect(listSql).toContain('e.event_title ILIKE');
    expect(listSql).not.toContain("e.llm_summary ->> 'title' ILIKE");
  });

  it('applies the multi-source filter', async () => {
    let listSql = '';
    const db = scriptedDb([
      { match: 'OFFSET', rows: [], onQuery: (sql) => { listSql = sql; } },
      { match: 'SELECT count(*) AS count', rows: [{ count: '0' }] },
      { match: 'FILTER (WHERE source_count > 1)', rows: [{ total: '0', multi_source: '0' }] },
      { match: 'GROUP BY severity', rows: [] },
    ]);
    // Just assert it runs and shapes correctly with the filter set.
    const overview = await loadEventsOverview(db, { minSources: 2, sort: 'sources_desc' });
    expect(overview.filtered).toBe(0);
    expect(listSql).toContain("ORDER BY e.llm_summary IS NOT NULL DESC, array_position(ARRAY['critical','high','medium','low'], severity), confidence DESC NULLS LAST");
  });

  it('keeps LLM summaries first when sorting by recent or severity', async () => {
    const orderBys: string[] = [];
    const db = scriptedDb([
      { match: 'OFFSET', rows: [], onQuery: (sql) => { orderBys.push(sql); } },
      { match: 'SELECT count(*) AS count', rows: [{ count: '0' }] },
      { match: 'FILTER (WHERE source_count > 1)', rows: [{ total: '0', multi_source: '0' }] },
      { match: 'GROUP BY severity', rows: [] },
    ]);

    await loadEventsOverview(db, { sort: 'recent' });
    await loadEventsOverview(db, { sort: 'severity' });

    expect(orderBys[0]).toContain('ORDER BY e.llm_summary IS NOT NULL DESC, last_seen_at DESC');
    expect(orderBys[1]).toContain("ORDER BY e.llm_summary IS NOT NULL DESC, array_position(ARRAY['critical','high','medium','low'], severity), confidence DESC NULLS LAST");
  });

  it('only includes approved events in list, filtered count, and summary', async () => {
    const sqls: string[] = [];
    const db = scriptedDb([
      { match: 'OFFSET', rows: [], onQuery: (sql) => { sqls.push(sql); } },
      { match: 'SELECT count(*) AS count', rows: [{ count: '0' }], onQuery: (sql) => { sqls.push(sql); } },
      { match: 'FILTER (WHERE source_count > 1)', rows: [{ total: '0', multi_source: '0' }], onQuery: (sql) => { sqls.push(sql); } },
      { match: 'GROUP BY severity', rows: [], onQuery: (sql) => { sqls.push(sql); } },
    ]);

    await loadEventsOverview(db, {});

    expect(sqls.length).toBeGreaterThanOrEqual(4);
    for (const sql of sqls) {
      expect(sql).toContain("e.publication_status = 'approved'");
    }
  });
});

describe('loadEventDetail', () => {
  it('returns the event with its sources ordered as a timeline', async () => {
    const db = scriptedDb([
      {
        match: 'WHERE e.id = $1',
        rows: [
          {
            id: '10',
            event_title: 'CyberArk exploited',
            event_summary: 'A zero-day is being exploited.',
            event_status: 'open',
            severity: 'high',
            urgency: 'P1',
            confidence: '0.82',
            source_count: 2,
            affected_vendors: ['CyberArk'],
            affected_products: ['PAM'],
            has_llm_summary: true,
            cves: ['CVE-2026-21001'],
            attack_types: ['exploitation'],
            grouping_key: 'cve:cve-2026-21001',
            first_seen_at: new Date('2026-07-01T08:00:00Z'),
            last_seen_at: new Date('2026-07-01T14:30:00Z'),
          },
        ],
      },
      {
        match: 'FROM event_articles ea',
        rows: [
          { article_id: '1', source_name: 'Krebs', title: 'First report', canonical_url: 'https://k/1', published_at: new Date('2026-07-01T08:00:00Z'), fetched_at: new Date('2026-07-01T08:05:00Z'), is_primary_source: true, is_material_update: false, relationship: 'same_event' },
          { article_id: '2', source_name: 'BleepingComputer', title: 'Follow-up', canonical_url: 'https://b/2', published_at: new Date('2026-07-01T14:30:00Z'), fetched_at: new Date('2026-07-01T14:35:00Z'), is_primary_source: false, is_material_update: true, relationship: 'same_event_material_update' },
        ],
      },
    ]);

    const detail = await loadEventDetail(db, '10');
    expect(detail?.sources).toHaveLength(2);
    expect(detail?.sources[0]).toMatchObject({ sourceName: 'Krebs', isPrimarySource: true });
    expect(detail?.sources[1]).toMatchObject({ sourceName: 'BleepingComputer', isMaterialUpdate: true });
    expect(detail?.groupingKey).toBe('cve:cve-2026-21001');
    expect(detail?.attackTypes).toEqual(['exploitation']);
    expect(detail?.affectedProducts).toEqual(['PAM']);
    expect(detail?.hasLlmSummary).toBe(true);
  });

  it('returns null for a missing event', async () => {
    const db = scriptedDb([{ match: 'WHERE e.id = $1', rows: [] }]);
    expect(await loadEventDetail(db, '999')).toBeNull();
  });

  it('only loads an event when it is approved', async () => {
    let detailSql = '';
    const db = scriptedDb([
      {
        match: 'WHERE e.id = $1',
        rows: [],
        onQuery: (sql) => {
          detailSql = sql;
        },
      },
    ]);

    expect(await loadEventDetail(db, '10')).toBeNull();
    expect(detailSql).toContain("e.publication_status = 'approved'");
    expect(detailSql).not.toContain('cardinality(coalesce(e.affected_vendors');
  });
});
