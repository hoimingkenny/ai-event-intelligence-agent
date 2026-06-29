import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArticleRepository } from '../src/db/repositories/article.repository.js';
import { FeedRepository } from '../src/db/repositories/feed.repository.js';
import { VendorRepository } from '../src/db/repositories/vendor.repository.js';

const databaseUrl = process.env.DATABASE_URL;
const runId = `repo_test_${Date.now()}`;

describe.skipIf(!databaseUrl)('database repositories', () => {
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
    await pool.query('DELETE FROM vendors WHERE name = $1', [`${runId} Vendor`]);
    await pool.end();
  });

  it('returns an existing article instead of creating duplicate canonical URLs', async () => {
    const feeds = new FeedRepository(pool);
    const articles = new ArticleRepository(pool);
    const feed = await feeds.upsertFeed({
      sourceName: `${runId} Feed`,
      feedUrl: `https://example.test/${runId}/feed.xml`,
      sourceType: 'rss',
    });

    const first = await articles.insertDiscoveredArticle({
      feedId: feed.id,
      sourceName: feed.sourceName,
      title: 'First title',
      canonicalUrl: `https://example.test/${runId}/article-1`,
      urlHash: `${runId}_url_hash`,
      titleHash: `${runId}_title_hash`,
      rssSummary: 'A first article summary.',
    });
    const second = await articles.insertDiscoveredArticle({
      feedId: feed.id,
      sourceName: feed.sourceName,
      title: 'Different title ignored by duplicate check',
      canonicalUrl: `https://example.test/${runId}/article-1`,
      urlHash: `${runId}_url_hash_2`,
      titleHash: `${runId}_title_hash_2`,
      rssSummary: 'A duplicate article summary.',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.article.id).toBe(first.article.id);
    expect(second.article.title).toBe('First title');
  });

  it('finds active vendors and products by aliases after idempotent seeding', async () => {
    const vendors = new VendorRepository(pool);

    await vendors.seedVendorProduct({
      vendor: `${runId} Vendor`,
      product: `${runId} Product`,
      aliases: [`${runId} Product Alias`, `${runId} Short Name`],
      criticality: 'high',
      inProduction: true,
    });
    await vendors.seedVendorProduct({
      vendor: `${runId} Vendor`,
      product: `${runId} Product`,
      aliases: [`${runId} Product Alias`, `${runId} Short Name`],
      criticality: 'medium',
      inProduction: true,
    });

    const vendor = await vendors.findActiveVendorByAlias(`${runId} Vendor`);
    const products = await vendors.findProductsByAlias(`${runId} Short Name`);

    expect(vendor?.name).toBe(`${runId} Vendor`);
    expect(vendor?.criticality).toBe('high');
    expect(products).toHaveLength(1);
    expect(products[0].productName).toBe(`${runId} Product`);
  });
});
