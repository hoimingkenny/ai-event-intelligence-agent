import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import { getWorkspaceArticle } from '../src/events/event-editorial.js';

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

describe('getWorkspaceArticle', () => {
  it('returns full body from cleanText with filter and entity signal blocks', async () => {
    const db = scriptedDb([
      {
        match: 'FROM articles',
        rows: [
          {
            id: '101',
            title: 'PAS advisory',
            source_name: 'CISA',
            canonical_url: 'https://example.com/a',
            published_at: new Date('2026-07-14T01:00:00Z'),
            fetched_at: new Date('2026-07-14T02:00:00Z'),
            processing_status: 'CLASSIFIED',
            extraction_status: 'ok',
            extraction_method: 'http',
            rss_summary: 'Short RSS',
            clean_text: 'Full extracted body about CyberArk PAS.',
            llm_classification: { relevance: 'high', summary: 'Ransomware on PAS' },
            llm_article_digest: {
              cyberRelevant: true,
              eventType: 'ransomware',
              severity: 'high',
              urgency: 'P1',
              confidence: 0.9,
              vendorRoles: [{ vendor: 'CyberArk', role: 'affected', rationale: 'PAS targeted.' }],
              affectedProducts: ['PAS'],
              cves: ['CVE-2024-1'],
              reasoning: 'Ransomware on PAS.',
            },
            cheap_filter_decision: 'KEEP',
            cheap_filter_matched_signals: {
              vendors: ['CyberArk'],
              products: [],
              cves: ['CVE-2024-1'],
              criticalCyberKeywords: ['ransomware'],
              mediumCyberKeywords: ['vulnerability'],
            },
          },
        ],
      },
      {
        match: 'FROM article_entities',
        rows: [
          {
            entity_type: 'product',
            entity_value: 'PAS',
            confidence: '0.9',
            role: 'affected',
          },
          {
            entity_type: 'cve',
            entity_value: 'CVE-2024-21762',
            confidence: '1',
            role: null,
          },
        ],
      },
    ]);

    const article = await getWorkspaceArticle(db, '101');

    expect(article).toMatchObject({
      id: '101',
      title: 'PAS advisory',
      sourceName: 'CISA',
      canonicalUrl: 'https://example.com/a',
      processingStatus: 'CLASSIFIED',
      extractionStatus: 'ok',
      extractionMethod: 'http',
      bodyText: 'Full extracted body about CyberArk PAS.',
      bodySource: 'cleanText',
      cheapFilterDecision: 'KEEP',
      llmArticleDigest: {
        cyberRelevant: true,
        eventType: 'ransomware',
        severity: 'high',
        urgency: 'P1',
        confidence: 0.9,
        vendorRoles: [{ vendor: 'CyberArk', role: 'affected', rationale: 'PAS targeted.' }],
        affectedProducts: ['PAS'],
        cves: ['CVE-2024-1'],
        reasoning: 'Ransomware on PAS.',
      },
      llmClassification: { relevance: 'high', summary: 'Ransomware on PAS' },
      filterSignals: {
        vendors: ['CyberArk'],
        products: [],
        cves: ['CVE-2024-1'],
        criticalKeywords: ['ransomware'],
      },
      extractedEntities: [
        {
          entityType: 'product',
          entityValue: 'PAS',
          confidence: 0.9,
          role: 'affected',
        },
        {
          entityType: 'cve',
          entityValue: 'CVE-2024-21762',
          confidence: 1,
          role: null,
        },
      ],
    });
  });

  it('falls back to rssSummary when cleanText is empty and handles missing classification', async () => {
    const db = scriptedDb([
      {
        match: 'FROM articles',
        rows: [
          {
            id: '202',
            title: 'RSS only',
            source_name: 'MSRC',
            canonical_url: null,
            published_at: null,
            fetched_at: new Date('2026-07-14T03:00:00Z'),
            processing_status: 'EXTRACTED',
            extraction_status: 'pending',
            extraction_method: null,
            rss_summary: 'RSS body only',
            clean_text: null,
            llm_classification: null,
            llm_article_digest: null,
            cheap_filter_decision: 'DROP',
            cheap_filter_matched_signals: null,
          },
        ],
      },
      {
        match: 'FROM article_entities',
        rows: [],
      },
    ]);

    const article = await getWorkspaceArticle(db, '202');

    expect(article?.bodyText).toBe('RSS body only');
    expect(article?.bodySource).toBe('rssSummary');
    expect(article?.cheapFilterDecision).toBe('DROP');
    expect(article?.llmArticleDigest).toBeNull();
    expect(article?.llmClassification).toBeNull();
    expect(article?.filterSignals).toEqual({
      vendors: [],
      products: [],
      cves: [],
      criticalKeywords: [],
    });
    expect(article?.extractedEntities).toEqual([]);
  });

  it('returns null body source when both cleanText and rssSummary are empty', async () => {
    const db = scriptedDb([
      {
        match: 'FROM articles',
        rows: [
          {
            id: '303',
            title: 'Empty body',
            source_name: 'CISA',
            canonical_url: null,
            published_at: null,
            fetched_at: new Date('2026-07-14T04:00:00Z'),
            processing_status: 'DISCOVERED',
            extraction_status: 'pending',
            extraction_method: null,
            rss_summary: '   ',
            clean_text: '',
            llm_classification: null,
            cheap_filter_matched_signals: null,
          },
        ],
      },
      {
        match: 'FROM article_entities',
        rows: [],
      },
    ]);

    const article = await getWorkspaceArticle(db, '303');
    expect(article?.bodyText).toBeNull();
    expect(article?.bodySource).toBeNull();
  });

  it('returns null when the article does not exist', async () => {
    const db = scriptedDb([{ match: 'FROM articles', rows: [] }]);
    expect(await getWorkspaceArticle(db, '999')).toBeNull();
  });
});
