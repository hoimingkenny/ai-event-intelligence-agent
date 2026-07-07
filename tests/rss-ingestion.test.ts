import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeedRepository } from '../src/db/repositories/feed.repository.js';
import { normalizeFeedItem } from '../src/rss/feed-normalizer.js';
import type { FetchedFeedItem, RssFetcher } from '../src/rss/rss-fetcher.js';
import { ingestRssFeeds } from '../src/pipeline/ingest-stage.js';

const databaseUrl = process.env.DATABASE_URL;
const runId = `rss_test_${Date.now()}`;

describe('normalizeFeedItem', () => {
  it('normalizes URLs, hashes metadata, and parses dates', () => {
    const normalized = normalizeFeedItem(
      {
        id: 'feed-1',
        sourceName: 'Example Feed',
        feedUrl: 'https://example.test/feed.xml',
        sourceType: 'rss',
        trustLevel: 'medium',
        isActive: true,
        lastFetchedAt: null,
      },
      {
        title: '  Critical Patch Released  ',
        link: 'https://Example.test/post/?utm_source=rss&b=2&a=1#top',
        contentSnippet: '  Patch details   released. ',
        categories: [' Vulnerabilities ', 'Security', 'Security'],
        isoDate: '2026-06-27T12:00:00.000Z',
      }
    );

    expect(normalized?.canonicalUrl).toBe('https://example.test/post?a=1&b=2');
    expect(normalized?.title).toBe('Critical Patch Released');
    expect(normalized?.urlHash).toHaveLength(64);
    expect(normalized?.titleHash).toHaveLength(64);
    expect(normalized?.rssSummary).toBe('Patch details released.');
    expect(normalized?.rssCategories).toEqual(['Vulnerabilities', 'Security']);
    expect(normalized?.publishedAt?.toISOString()).toBe('2026-06-27T12:00:00.000Z');
  });

  it('skips items without a link or guid', () => {
    const normalized = normalizeFeedItem(
      {
        id: 'feed-1',
        sourceName: 'Example Feed',
        feedUrl: 'https://example.test/feed.xml',
        sourceType: 'rss',
        trustLevel: 'medium',
        isActive: true,
        lastFetchedAt: null,
      },
      { title: 'No URL' }
    );

    expect(normalized).toBeNull();
  });
});

class FixtureFetcher implements RssFetcher {
  constructor(private readonly items: FetchedFeedItem[]) {}

  async fetch(): Promise<FetchedFeedItem[]> {
    return this.items;
  }
}

describe.skipIf(!databaseUrl)('ingestRssFeeds', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM articles WHERE canonical_url LIKE $1', [
      `https://example.test/${runId}/%`,
    ]);
    await pool.query('DELETE FROM feeds WHERE feed_url LIKE $1', [
      `https://example.test/${runId}/%`,
    ]);
    await pool.end();
  });

  it('stores new articles and skips duplicates by canonical URL', async () => {
    const feeds = new FeedRepository(pool);
    await feeds.upsertFeed({
      sourceName: `${runId} Feed`,
      feedUrl: `https://example.test/${runId}/feed.xml`,
      sourceType: 'rss',
    });

    const fetcher = new FixtureFetcher([
      {
        title: 'First article',
        link: `https://example.test/${runId}/article-1?utm_source=rss`,
        contentSnippet: 'First article summary.',
        categories: ['Vulnerabilities'],
        isoDate: '2026-06-27T12:00:00.000Z',
      },
      {
        title: 'Duplicate article',
        link: `https://example.test/${runId}/article-1#fragment`,
        contentSnippet: 'Duplicate summary.',
        isoDate: '2026-06-27T12:30:00.000Z',
      },
      {
        title: 'Second article',
        link: `https://example.test/${runId}/article-2`,
        contentSnippet: 'Second article summary.',
      },
      {
        title: 'Skipped item',
      },
    ]);

    const firstRun = await ingestRssFeeds(pool, {
      fetcher,
      feedUrls: [`https://example.test/${runId}/feed.xml`],
    });
    const secondRun = await ingestRssFeeds(pool, {
      fetcher,
      feedUrls: [`https://example.test/${runId}/feed.xml`],
    });

    expect(firstRun.fetched).toBe(4);
    expect(firstRun.created).toBe(2);
    expect(firstRun.duplicates).toBe(1);
    expect(firstRun.skipped).toBe(1);
    expect(secondRun.created).toBe(0);
    expect(secondRun.duplicates).toBe(3);
    expect(secondRun.skipped).toBe(1);

    const count = await pool.query<{ count: string }>(
      'SELECT count(*) FROM articles WHERE canonical_url LIKE $1',
      [`https://example.test/${runId}/%`]
    );
    expect(Number(count.rows[0].count)).toBe(2);

    const categories = await pool.query<{ rss_categories: string[] }>(
      'SELECT rss_categories FROM articles WHERE canonical_url = $1',
      [`https://example.test/${runId}/article-1`]
    );
    expect(categories.rows[0].rss_categories).toEqual(['Vulnerabilities']);
  });
});
