import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import {
  createFeed,
  setFeedActive,
  updateFeed,
  WorkspaceFeedWriteError,
} from '../src/workspace/workspace-feed-writes.js';

type Handler = {
  match: string;
  rows?: unknown[];
  error?: unknown;
};

function scriptedDb(handlers: Handler[]) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const db = {
    async query<T>(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      const handler = handlers.find((candidate) => sql.includes(candidate.match));
      if (handler?.error) throw handler.error;
      return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows?.length ?? 0 };
    },
  } as Queryable;
  return { db, calls };
}

const feedRow = {
  id: '10',
  source_name: 'CISA',
  feed_url: 'https://www.cisa.gov/feed.xml',
  source_type: 'rss',
  trust_level: 'high',
  is_active: true,
  last_fetched_at: null,
};

describe('workspace feed writes', () => {
  it('creates workspace feeds as rss without triggering ingestion', async () => {
    const { db, calls } = scriptedDb([{ match: 'INSERT INTO feeds', rows: [feedRow] }]);

    const feed = await createFeed(db, {
      sourceName: '  CISA  ',
      feedUrl: '  https://www.cisa.gov/feed.xml  ',
      trustLevel: 'high',
      isActive: true,
    });

    expect(feed).toMatchObject({ id: '10', sourceType: 'rss', isActive: true });
    const insert = calls.find((call) => call.sql.includes('INSERT INTO feeds'));
    expect(insert?.sql).toContain("VALUES ($1, $2, 'rss', $3, $4, now())");
    expect(insert?.params).toEqual([
      'CISA',
      'https://www.cisa.gov/feed.xml',
      'high',
      true,
    ]);
    expect(calls.every((call) => !call.sql.includes('articles'))).toBe(true);
  });

  it('edits only source name, URL, and trust level, leaving source type locked', async () => {
    const updatedRow = {
      ...feedRow,
      source_name: 'CISA Advisories',
      feed_url: 'https://www.cisa.gov/advisories.xml',
      trust_level: 'medium',
    };
    const { db, calls } = scriptedDb([{ match: 'UPDATE feeds', rows: [updatedRow] }]);

    const feed = await updateFeed(db, '10', {
      sourceName: 'CISA Advisories',
      feedUrl: 'https://www.cisa.gov/advisories.xml',
      trustLevel: 'medium',
    });

    expect(feed).toMatchObject({ sourceName: 'CISA Advisories', sourceType: 'rss' });
    const update = calls[0];
    expect(update?.sql).not.toContain('source_type =');
    expect(update?.sql).not.toContain('is_active =');
    expect(update?.params).toEqual([
      '10',
      'CISA Advisories',
      'https://www.cisa.gov/advisories.xml',
      'medium',
    ]);
  });

  it('rejects an invalid trust level before querying the database', async () => {
    const { db, calls } = scriptedDb([]);

    await expect(
      createFeed(db, {
        sourceName: 'CISA',
        feedUrl: 'https://www.cisa.gov/feed.xml',
        trustLevel: 'critical' as 'high',
        isActive: true,
      })
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toHaveLength(0);
  });

  it('soft-deactivates and reactivates without deleting the feed', async () => {
    const { db, calls } = scriptedDb([
      { match: 'SELECT is_active', rows: [{ is_active: true }] },
      { match: 'COUNT(*)::int', rows: [{ active_count: 2 }] },
      { match: 'UPDATE feeds', rows: [{ ...feedRow, is_active: false }] },
    ]);

    const feed = await setFeedActive(db, '10', false);

    expect(feed.isActive).toBe(false);
    const update = calls.find((call) => call.sql.includes('UPDATE feeds'));
    expect(update?.sql).toContain('EXISTS');
    expect(calls.every((call) => !call.sql.includes('DELETE'))).toBe(true);

    const reactivation = scriptedDb([
      { match: 'SELECT is_active', rows: [{ is_active: false }] },
      { match: 'UPDATE feeds', rows: [feedRow] },
    ]);
    await expect(setFeedActive(reactivation.db, '10', true)).resolves.toMatchObject({
      isActive: true,
    });
    expect(reactivation.calls.some((call) => call.sql.includes('COUNT(*)'))).toBe(false);
  });

  it('rejects deactivating the last active feed without issuing a write', async () => {
    const { db, calls } = scriptedDb([
      { match: 'SELECT is_active', rows: [{ is_active: true }] },
      { match: 'COUNT(*)::int', rows: [{ active_count: 1 }] },
    ]);

    await expect(setFeedActive(db, '10', false)).rejects.toMatchObject({
      code: 'last_active_feed',
    });
    expect(calls.some((call) => /\b(?:INSERT|UPDATE|DELETE)\b/.test(call.sql))).toBe(false);
  });

  it('maps a duplicate feed URL to the typed workspace error', async () => {
    const duplicate = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
    const { db, calls } = scriptedDb([{ match: 'INSERT INTO feeds', error: duplicate }]);

    const result = createFeed(db, {
      sourceName: 'Duplicate',
      feedUrl: 'https://www.cisa.gov/feed.xml',
      trustLevel: 'medium',
      isActive: true,
    });

    await expect(result).rejects.toBeInstanceOf(WorkspaceFeedWriteError);
    await expect(result).rejects.toMatchObject({ code: 'duplicate_url' });
    expect(calls.filter((call) => call.sql.includes('INSERT INTO feeds'))).toHaveLength(1);
  });

  it('rejects creating an inactive feed when no feed is active without issuing a write', async () => {
    const { db, calls } = scriptedDb([
      { match: 'COUNT(*)::int', rows: [{ active_count: 0 }] },
    ]);

    await expect(
      createFeed(db, {
        sourceName: 'Inactive source',
        feedUrl: 'https://example.com/feed.xml',
        trustLevel: 'low',
        isActive: false,
      })
    ).rejects.toMatchObject({ code: 'last_active_feed' });
    expect(calls.some((call) => /\b(?:INSERT|UPDATE|DELETE)\b/.test(call.sql))).toBe(false);
  });
});
