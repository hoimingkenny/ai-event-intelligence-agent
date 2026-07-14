import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import {
  attachArticleToEvent,
  createEventFromArticles,
  detachArticleFromEvent,
  listArticlesNeedingTriage,
  listWorkspaceEventArticles,
  moveArticleBetweenEvents,
} from '../src/events/event-editorial.js';

function scriptedDb(
  handlers: Array<{
    match: string;
    rows?: unknown[];
    onQuery?: (sql: string, params?: unknown[]) => void;
  }>,
  options: { withConnect?: boolean } = {}
): { db: Queryable; calls: Array<{ sql: string; params?: unknown[] }> } {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];

  const query = async <T>(sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const normalized = sql.trim().toUpperCase();
    if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
      return { rows: [] as T[], rowCount: 0 };
    }
    const handler = handlers.find((h) => sql.includes(h.match));
    handler?.onQuery?.(sql, params);
    return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows?.length ?? 0 };
  };

  const client = {
    query,
    release() {},
  };

  const db = {
    query,
    ...(options.withConnect
      ? {
          async connect() {
            return client;
          },
        }
      : {}),
  } as Queryable;

  return { db, calls };
}

const draftEventRow = {
  id: '50',
  grouping_key: null,
  first_seen_at: new Date('2026-07-14T00:00:00Z'),
  event_title: 'New analyst event',
  event_summary: null,
  event_status: 'open',
  publication_status: 'draft',
  severity: null,
  urgency: null,
  confidence: null,
  affected_vendors: [],
  affected_products: [],
  cves: [],
  attack_types: [],
  summary_stale: false,
};

const articleRow = {
  id: '101',
  feed_id: null,
  source_name: 'CISA',
  title: 'Advisory about PAS',
  canonical_url: 'https://example.com/a',
  url_hash: null,
  title_hash: null,
  content_hash: null,
  rss_summary: null,
  rss_categories: [],
  clean_text: null,
  published_at: new Date('2026-07-14T01:00:00Z'),
  extraction_status: 'ok',
  extraction_method: 'http',
  extraction_error: null,
  processing_status: 'CLASSIFIED',
};

describe('event editorial membership', () => {
  it('creates a draft event and attaches every selected article', async () => {
    const attached: Array<unknown[] | undefined> = [];
    const { db, calls } = scriptedDb([
      {
        match: 'FROM articles',
        rows: [
          { ...articleRow, id: '101', title: 'First' },
          { ...articleRow, id: '102', title: 'Second' },
        ],
      },
      {
        match: 'INSERT INTO cyber_events',
        rows: [{ ...draftEventRow, event_title: 'First' }],
      },
      {
        match: 'INSERT INTO event_articles',
        rows: [],
        onQuery: (_sql, params) => {
          attached.push(params);
        },
      },
      {
        match: 'UPDATE cyber_events',
        rows: [],
      },
    ]);

    const event = await createEventFromArticles(db, {
      articleIds: ['101', '102'],
    });

    const insert = calls.find((c) => c.sql.includes('INSERT INTO cyber_events'));
    expect(insert?.params).toContain('draft');
    expect(event.publicationStatus).toBe('draft');
    expect(attached).toHaveLength(2);
    expect(attached[0]?.[0]).toBe('50');
    expect(attached[0]?.[1]).toBe('101');
    expect(attached[1]?.[1]).toBe('102');
    expect(attached[0]?.[4]).toBe(true); // first article is primary
    expect(attached[1]?.[4]).toBe(false);
    expect(calls.some((c) => c.sql.trim().toUpperCase() === 'BEGIN')).toBe(true);
    expect(calls.some((c) => c.sql.trim().toUpperCase() === 'COMMIT')).toBe(true);
  });

  it('rejects create when no articles are selected', async () => {
    const { db } = scriptedDb([]);
    await expect(createEventFromArticles(db, { articleIds: [] })).rejects.toThrow(/at least one article/i);
  });

  it('rolls back create when a later attach fails', async () => {
    let attachCount = 0;
    const { db, calls } = scriptedDb(
      [
        {
          match: 'FROM articles',
          rows: [
            { ...articleRow, id: '101', title: 'First' },
            { ...articleRow, id: '102', title: 'Second' },
          ],
        },
        {
          match: 'INSERT INTO cyber_events',
          rows: [{ ...draftEventRow, event_title: 'First' }],
        },
        {
          match: 'INSERT INTO event_articles',
          rows: [],
          onQuery: () => {
            attachCount += 1;
            if (attachCount > 1) {
              throw new Error('attach boom');
            }
          },
        },
        { match: 'UPDATE cyber_events', rows: [] },
      ],
      { withConnect: true }
    );

    await expect(createEventFromArticles(db, { articleIds: ['101', '102'] })).rejects.toThrow(
      'attach boom'
    );

    expect(calls.some((c) => c.sql.trim().toUpperCase() === 'ROLLBACK')).toBe(true);
    expect(calls.some((c) => c.sql.trim().toUpperCase() === 'COMMIT')).toBe(false);
  });

  it('attaches an article to an event', async () => {
    let attachParams: unknown[] | undefined;
    const { db } = scriptedDb([
      {
        match: 'INSERT INTO event_articles',
        rows: [],
        onQuery: (_sql, params) => {
          attachParams = params;
        },
      },
      { match: 'UPDATE cyber_events', rows: [] },
    ]);

    await attachArticleToEvent(db, '50', '101');

    expect(attachParams?.[0]).toBe('50');
    expect(attachParams?.[1]).toBe('101');
  });

  it('detaches an article and refreshes source_count', async () => {
    const { db, calls } = scriptedDb([
      { match: 'DELETE FROM event_articles', rows: [{ id: '1' }] },
      { match: 'UPDATE cyber_events', rows: [] },
    ]);

    await detachArticleFromEvent(db, '50', '101');

    const del = calls.find((c) => c.sql.includes('DELETE FROM event_articles'));
    expect(del?.params).toEqual(['50', '101']);
    expect(calls.some((c) => c.sql.includes('source_count'))).toBe(true);
  });

  it('moves an article by detaching from one event and attaching to another', async () => {
    const { db, calls } = scriptedDb([
      { match: 'DELETE FROM event_articles', rows: [{ id: '1' }] },
      { match: 'UPDATE cyber_events', rows: [] },
      { match: 'INSERT INTO event_articles', rows: [] },
    ]);

    await moveArticleBetweenEvents(db, {
      articleId: '101',
      fromEventId: '50',
      toEventId: '60',
    });

    const del = calls.find((c) => c.sql.includes('DELETE FROM event_articles'));
    const ins = calls.find((c) => c.sql.includes('INSERT INTO event_articles'));
    expect(del?.params).toEqual(['50', '101']);
    expect(ins?.params?.[0]).toBe('60');
    expect(ins?.params?.[1]).toBe('101');
    expect(calls.some((c) => c.sql.trim().toUpperCase() === 'BEGIN')).toBe(true);
    expect(calls.some((c) => c.sql.trim().toUpperCase() === 'COMMIT')).toBe(true);
  });

  it('rolls back move when attach fails after detach', async () => {
    const { db, calls } = scriptedDb(
      [
        { match: 'DELETE FROM event_articles', rows: [{ id: '1' }] },
        { match: 'UPDATE cyber_events', rows: [] },
        {
          match: 'INSERT INTO event_articles',
          rows: [],
          onQuery: () => {
            throw new Error('attach after detach failed');
          },
        },
      ],
      { withConnect: true }
    );

    await expect(
      moveArticleBetweenEvents(db, {
        articleId: '101',
        fromEventId: '50',
        toEventId: '60',
      })
    ).rejects.toThrow('attach after detach failed');

    expect(calls.some((c) => c.sql.includes('DELETE FROM event_articles'))).toBe(true);
    expect(calls.some((c) => c.sql.trim().toUpperCase() === 'ROLLBACK')).toBe(true);
    expect(calls.some((c) => c.sql.trim().toUpperCase() === 'COMMIT')).toBe(false);
  });

  it('lists articles needing triage as those not on any approved event', async () => {
    let listSql = '';
    const { db } = scriptedDb([
      {
        match: 'FROM articles',
        rows: [articleRow],
        onQuery: (sql) => {
          listSql = sql;
        },
      },
    ]);

    const items = await listArticlesNeedingTriage(db, { limit: 25 });

    expect(listSql).toMatch(/publication_status\s*=\s*'approved'/);
    expect(listSql).toMatch(/NOT EXISTS/i);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('101');
  });

  it('lists articles currently attached to a workspace event', async () => {
    const { db } = scriptedDb([
      {
        match: 'FROM event_articles',
        rows: [articleRow],
      },
    ]);

    const items = await listWorkspaceEventArticles(db, '50');
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('101');
  });
});
