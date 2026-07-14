import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import { listArticlesNeedingTriagePage } from '../src/events/event-editorial.js';
import { summarizeTriageSignals } from '../src/events/triage-signals.js';

describe('summarizeTriageSignals', () => {
  it('ORs vendor/product and CVE from filter signals and entities; critical keywords from filter only', () => {
    const summary = summarizeTriageSignals(
      {
        vendors: ['CyberArk'],
        products: [],
        cves: [],
        criticalCyberKeywords: ['ransomware'],
        mediumCyberKeywords: ['vulnerability'],
        lowCyberKeywords: [],
        negativeKeywords: [],
        rssCategories: [],
        sourceTier: 'security_media',
      },
      [
        { entityType: 'product', entityValue: 'PAS' },
        { entityType: 'cve', entityValue: 'CVE-2024-21762' },
        { entityType: 'attack_type', entityValue: 'vulnerability' },
      ]
    );

    expect(summary).toEqual({
      hasVendorOrProduct: true,
      hasCve: true,
      hasCriticalKeyword: true,
      vendorProductNames: ['CyberArk', 'PAS'],
      cveIds: ['CVE-2024-21762'],
      criticalKeywords: ['ransomware'],
    });
  });

  it('ignores medium and low cyber keywords for the critical-keyword flag', () => {
    const summary = summarizeTriageSignals(
      {
        vendors: [],
        products: [],
        cves: [],
        criticalCyberKeywords: [],
        mediumCyberKeywords: ['breach'],
        lowCyberKeywords: ['security'],
        negativeKeywords: [],
        rssCategories: [],
        sourceTier: 'unknown',
      },
      []
    );

    expect(summary.hasCriticalKeyword).toBe(false);
    expect(summary.criticalKeywords).toEqual([]);
  });
});

function scriptedDb(
  handlers: Array<{
    match: string;
    rows?: unknown[];
  }>
): Queryable {
  return {
    async query<T>(sql: string) {
      const handler = handlers.find((h) => sql.includes(h.match));
      return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows?.length ?? 0 };
    },
  };
}

describe('listArticlesNeedingTriagePage skim enrichment', () => {
  it('returns presence tooltips and draft membership for needs-triage articles', async () => {
    const db = scriptedDb([
      {
        match: 'COUNT(*)',
        rows: [{ count: '1' }],
      },
      {
        match: 'FROM articles a',
        rows: [
          {
            id: '101',
            title: 'PAS ransomware advisory',
            canonical_url: 'https://example.com/a',
            source_name: 'CISA',
            published_at: new Date('2026-07-14T01:00:00Z'),
            cheap_filter_matched_signals: {
              vendors: ['CyberArk'],
              products: [],
              cves: [],
              criticalCyberKeywords: ['ransomware'],
              mediumCyberKeywords: [],
              lowCyberKeywords: [],
              negativeKeywords: [],
              rssCategories: [],
              sourceTier: 'government_cert',
            },
          },
        ],
      },
      {
        match: 'FROM article_entities',
        rows: [
          { article_id: '101', entity_type: 'cve', entity_value: 'CVE-2024-21762' },
          { article_id: '101', entity_type: 'product', entity_value: 'PAS' },
        ],
      },
      {
        match: 'publication_status = \'draft\'',
        rows: [
          {
            article_id: '101',
            event_id: '60',
            event_title: 'Newer draft',
            updated_at: new Date('2026-07-14T00:00:00Z'),
          },
          {
            article_id: '101',
            event_id: '50',
            event_title: 'Older draft',
            updated_at: new Date('2026-07-10T00:00:00Z'),
          },
        ],
      },
    ]);

    const page = await listArticlesNeedingTriagePage(db, { limit: 25, offset: 0 });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    const item = page.items[0]!;
    expect(item.id).toBe('101');
    expect(item.title).toBe('PAS ransomware advisory');
    expect(item.signals).toEqual({
      hasVendorOrProduct: true,
      hasCve: true,
      hasCriticalKeyword: true,
      vendorProductNames: ['CyberArk', 'PAS'],
      cveIds: ['CVE-2024-21762'],
      criticalKeywords: ['ransomware'],
    });
    expect(item.draft).toEqual({
      primaryEventId: '60',
      eventTitles: ['Newer draft', 'Older draft'],
    });
  });

  it('returns null draft when the article is not on any draft event', async () => {
    const db = scriptedDb([
      {
        match: 'COUNT(*)',
        rows: [{ count: '1' }],
      },
      {
        match: 'FROM articles a',
        rows: [
          {
            id: '202',
            title: 'No draft yet',
            canonical_url: null,
            source_name: 'MSRC',
            published_at: null,
            cheap_filter_matched_signals: null,
          },
        ],
      },
      {
        match: 'FROM article_entities',
        rows: [],
      },
      {
        match: 'publication_status = \'draft\'',
        rows: [],
      },
    ]);

    const page = await listArticlesNeedingTriagePage(db, { limit: 10, offset: 0 });
    expect(page.items[0]?.draft).toBeNull();
    expect(page.items[0]?.signals.hasVendorOrProduct).toBe(false);
    expect(page.items[0]?.signals.hasCve).toBe(false);
    expect(page.items[0]?.signals.hasCriticalKeyword).toBe(false);
  });
});
