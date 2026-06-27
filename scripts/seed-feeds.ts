import { rssFeeds } from '../src/config/rssFeeds.js';
import { getDatabasePool } from '../src/db/pool.js';
import { FeedRepository } from '../src/db/repositories/feed.repository.js';

async function main(): Promise<void> {
  const pool = getDatabasePool();
  const feeds = new FeedRepository(pool);

  try {
    for (const feed of rssFeeds) {
      await feeds.upsertFeed({
        sourceName: feed.source,
        feedUrl: feed.url,
        sourceType: 'rss',
        trustLevel: feed.source === 'CISA' ? 'high' : 'medium',
        isActive: true,
      });
    }

    console.log(`Seeded ${rssFeeds.length} RSS feed(s).`);
  } finally {
    await pool.end();
  }
}

await main();
