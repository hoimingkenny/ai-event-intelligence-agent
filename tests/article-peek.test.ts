import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import {
  compactLlmDigest,
  getArticlePeek,
  truncateArticleExcerpt,
} from '../src/events/event-editorial.js';

describe('truncateArticleExcerpt', () => {
  it('prefers cleanText and truncates around 700 characters', () => {
    const long = 'x'.repeat(900);
    const result = truncateArticleExcerpt(long, 'rss short');
    expect(result.bodySource).toBe('cleanText');
    expect(result.excerpt.length).toBeLessThanOrEqual(801);
    expect(result.excerpt.endsWith('…')).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('falls back to rssSummary when cleanText is empty', () => {
    const result = truncateArticleExcerpt('  ', 'RSS only text');
    expect(result).toEqual({
      excerpt: 'RSS only text',
      bodySource: 'rssSummary',
      truncated: false,
    });
  });
});

describe('compactLlmDigest', () => {
  it('returns null when classification is missing', () => {
    expect(compactLlmDigest(null, 'CLASSIFIED')).toEqual({
      digest: null,
      emptyReason: 'No LLM classification yet (status: CLASSIFIED).',
    });
  });

  it('prefers summary-like fields when present', () => {
    const { digest, emptyReason } = compactLlmDigest(
      {
        summary: 'Material ransomware on PAS',
        relevance: 'high',
        severity: 'critical',
        noise: 'x'.repeat(500),
      },
      'CLASSIFIED'
    );
    expect(emptyReason).toBeNull();
    expect(digest).toContain('Material ransomware on PAS');
    expect(digest).toContain('relevance');
    expect(digest!.length).toBeLessThan(600);
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

describe('getArticlePeek', () => {
  it('returns excerpt, both signal blocks, and compact digest without full body', async () => {
    const clean = `Full extracted ${'body '.repeat(200)}`;
    const db = scriptedDb([
      {
        match: 'FROM articles',
        rows: [
          {
            id: '101',
            title: 'PAS advisory',
            source_name: 'CISA',
            processing_status: 'CLASSIFIED',
            extraction_status: 'ok',
            rss_summary: 'Short RSS',
            clean_text: clean,
            llm_classification: { summary: 'Actively exploited PAS issue', severity: 'high' },
            cheap_filter_matched_signals: {
              vendors: ['CyberArk'],
              products: [],
              cves: [],
              criticalCyberKeywords: ['ransomware'],
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
        ],
      },
    ]);

    const peek = await getArticlePeek(db, '101');
    expect(peek).not.toBeNull();
    expect(peek!.id).toBe('101');
    expect(peek!.title).toBe('PAS advisory');
    expect(peek!.excerpt.length).toBeLessThan(clean.length);
    expect(peek!.truncated).toBe(true);
    expect(peek!.bodySource).toBe('cleanText');
    expect(peek!.workspaceArticlePath).toBe('/workspace/articles/101');
    expect(peek!.filterSignals.vendors).toEqual(['CyberArk']);
    expect(peek!.extractedEntities).toEqual([
      expect.objectContaining({ entityType: 'product', entityValue: 'PAS' }),
    ]);
    expect(peek!.llmDigest).toContain('Actively exploited PAS issue');
    expect(peek!.llmEmptyReason).toBeNull();
    expect(peek).not.toHaveProperty('bodyText');
    expect(peek).not.toHaveProperty('llmClassification');
  });

  it('returns empty digest reason when classification is missing', async () => {
    const db = scriptedDb([
      {
        match: 'FROM articles',
        rows: [
          {
            id: '202',
            title: 'Pending',
            source_name: 'MSRC',
            processing_status: 'EXTRACTED',
            extraction_status: 'ok',
            rss_summary: 'RSS',
            clean_text: null,
            llm_classification: null,
            cheap_filter_matched_signals: null,
          },
        ],
      },
      { match: 'FROM article_entities', rows: [] },
    ]);

    const peek = await getArticlePeek(db, '202');
    expect(peek?.excerpt).toBe('RSS');
    expect(peek?.bodySource).toBe('rssSummary');
    expect(peek?.llmDigest).toBeNull();
    expect(peek?.llmEmptyReason).toMatch(/No LLM classification yet/);
  });
});

describe('Needs triage list stays slim vs peek', () => {
  it('list enrichment omits excerpt and LLM payload fields', async () => {
    const { listArticlesNeedingTriagePage } = await import('../src/events/event-editorial.js');
    const db = scriptedDb([
      { match: 'COUNT(*)', rows: [{ count: '1' }] },
      {
        match: 'cheap_filter_matched_signals',
        rows: [
          {
            id: '101',
            title: 'Slim',
            canonical_url: null,
            source_name: 'CISA',
            published_at: null,
            processing_status: 'DIGESTING',
            cheap_filter_matched_signals: null,
          },
        ],
      },
      { match: 'FROM article_entities', rows: [] },
      { match: "publication_status = 'draft'", rows: [] },
    ]);

    const page = await listArticlesNeedingTriagePage(db, { limit: 10, offset: 0 });
    const item = page.items[0]!;
    expect(item).not.toHaveProperty('excerpt');
    expect(item).not.toHaveProperty('llmDigest');
    expect(item).not.toHaveProperty('llmClassification');
    expect(item).not.toHaveProperty('bodyText');
    expect(item).toHaveProperty('signals');
  });
});
