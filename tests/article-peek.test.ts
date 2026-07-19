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
      emptyReason: 'No LLM digest yet (status: CLASSIFIED).',
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
  it('returns article assessment summary without excerpt or legacy digest blocks', async () => {
    const db = scriptedDb([
      {
        match: 'FROM articles',
        rows: [
          {
            id: '101',
            title: 'PAS advisory',
            source_name: 'CISA',
          },
        ],
      },
      {
        match: 'FROM analysis_tasks',
        rows: [
          {
            id: '1',
            target_type: 'article',
            target_id: '101',
            task_name: 'article_summary',
            status: 'completed',
            attempts: 1,
            max_attempts: 3,
            next_attempt_at: null,
            input_payload: {},
            result: { summary: 'Actively exploited PAS issue requiring patch review.' },
            prompt_version: 'v1',
            model: 'test',
            last_error: null,
            completed_at: new Date('2026-07-01T00:00:00Z'),
            created_at: new Date('2026-07-01T00:00:00Z'),
            updated_at: new Date('2026-07-01T00:00:00Z'),
          },
        ],
      },
    ]);

    const peek = await getArticlePeek(db, '101');
    expect(peek).not.toBeNull();
    expect(peek!.id).toBe('101');
    expect(peek!.title).toBe('PAS advisory');
    expect(peek!.sourceName).toBe('CISA');
    expect(peek!.workspaceArticlePath).toBe('/workspace/articles/101');
    expect(peek!.assessmentSummary).toEqual({
      status: 'completed',
      attempts: 1,
      lastError: null,
      summary: 'Actively exploited PAS issue requiring patch review.',
    });
    expect(peek).not.toHaveProperty('excerpt');
    expect(peek).not.toHaveProperty('llmDigest');
    expect(peek).not.toHaveProperty('filterSignals');
  });

  it('returns null assessment when summary task is missing', async () => {
    const db = scriptedDb([
      {
        match: 'FROM articles',
        rows: [
          {
            id: '202',
            title: 'Pending',
            source_name: 'MSRC',
          },
        ],
      },
      { match: 'FROM analysis_tasks', rows: [] },
    ]);

    const peek = await getArticlePeek(db, '202');
    expect(peek?.assessmentSummary).toBeNull();
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
