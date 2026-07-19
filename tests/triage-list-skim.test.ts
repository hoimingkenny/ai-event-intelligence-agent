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
            processing_status: 'DIGESTED',
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
    expect(item.processingStatus).toBe('DIGESTED');
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
    expect(item.mvpSignals).toEqual({
      actionable: false,
      hasCve: false,
      disposition: null,
      cveIds: [],
      cvssGrade: null,
      kevCveIds: [],
      epssGrade: null,
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
            processing_status: 'ENTITY_EXTRACTED',
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
    expect(page.items[0]?.mvpSignals.actionable).toBe(false);
    expect(page.items[0]?.mvpSignals.hasCve).toBe(false);
  });

  it('marks mvpSignals from disposition and cve_mentions', async () => {
    let dispositionSeen = false;
    const richDb: Queryable = {
      async query<T>(sql: string, params?: unknown[]) {
        if (sql.includes('COUNT(*)')) return { rows: [{ count: '1' }] as T[], rowCount: 1 };
        if (sql.includes('FROM articles a')) {
          return {
            rows: [
              {
                id: '303',
                title: '7-Zip RCE',
                canonical_url: 'https://example.com/7zip',
                source_name: 'THN',
                published_at: new Date('2026-07-18T00:00:00Z'),
                processing_status: 'EXTRACTION_SUCCESS',
                cheap_filter_matched_signals: null,
              },
            ] as T[],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM article_entities')) return { rows: [] as T[], rowCount: 0 };
        if (sql.includes("publication_status = 'draft'")) return { rows: [] as T[], rowCount: 0 };
        if (sql.includes('FROM cve_mentions')) {
          return {
            rows: [
              {
                article_id: '303',
                cve_id: 'CVE-2025-8088',
                zone: 'clean_text',
                snippet: 'mention',
                start_offset: 0,
                end_offset: 10,
              },
            ] as T[],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM analysis_tasks') && sql.includes("status = 'completed'")) {
          const taskName = typeof params?.[2] === 'string' ? params[2] : '';
          if (taskName === 'article_disposition') {
            dispositionSeen = true;
            return {
              rows: [
                {
                  id: '1',
                  target_type: 'article',
                  target_id: '303',
                  task_name: 'article_disposition',
                  status: 'completed',
                  attempts: 1,
                  max_attempts: 5,
                  next_attempt_at: null,
                  input_payload: {},
                  result: { disposition: 'actionable', reason: null, signals: [], reasoning: 'x' },
                  prompt_version: 'v1',
                  model: 'test',
                  last_error: null,
                  completed_at: new Date(),
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ] as T[],
              rowCount: 1,
            };
          }
        }
        return { rows: [] as T[], rowCount: 0 };
      },
    };

    const page = await listArticlesNeedingTriagePage(richDb, { limit: 10, offset: 0 });
    expect(dispositionSeen).toBe(true);
    expect(page.items[0]?.mvpSignals).toEqual({
      actionable: true,
      hasCve: true,
      disposition: 'actionable',
      cveIds: ['CVE-2025-8088'],
      cvssGrade: null,
      kevCveIds: [],
      epssGrade: null,
    });
  });
});
