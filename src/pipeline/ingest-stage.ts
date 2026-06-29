import { ArticleRepository } from '../db/repositories/article.repository.js';
import { FeedRepository } from '../db/repositories/feed.repository.js';
import { normalizeFeedItem } from '../rss/feed-normalizer.js';
import { ParserRssFetcher, type RssFetcher } from '../rss/rss-fetcher.js';
import type { Queryable } from '../db/repositories/types.js';

export interface IngestFeedResult {
  feedId: string;
  sourceName: string;
  fetched: number;
  created: number;
  duplicates: number;
  skipped: number;
  errors: string[];
}

export interface IngestResult {
  feeds: IngestFeedResult[];
  fetched: number;
  created: number;
  duplicates: number;
  skipped: number;
  errors: number;
}

export interface IngestOptions {
  fetcher?: RssFetcher;
  feedUrls?: string[];
  limitFeeds?: number;
}

export async function ingestRssFeeds(db: Queryable, options: IngestOptions = {}): Promise<IngestResult> {
  const feedRepository = new FeedRepository(db);
  const articleRepository = new ArticleRepository(db);
  const fetcher = options.fetcher ?? new ParserRssFetcher();
  const activeFeeds = await feedRepository.listActiveFeeds();
  const feedUrlFilter = options.feedUrls ? new Set(options.feedUrls) : null;
  const filteredFeeds = feedUrlFilter
    ? activeFeeds.filter((feed) => feedUrlFilter.has(feed.feedUrl))
    : activeFeeds;
  const feeds = options.limitFeeds ? filteredFeeds.slice(0, options.limitFeeds) : filteredFeeds;
  const results: IngestFeedResult[] = [];

  for (const feed of feeds) {
    const result: IngestFeedResult = {
      feedId: feed.id,
      sourceName: feed.sourceName,
      fetched: 0,
      created: 0,
      duplicates: 0,
      skipped: 0,
      errors: [],
    };

    try {
      const items = await fetcher.fetch(feed.feedUrl);
      result.fetched = items.length;

      for (const item of items) {
        let normalized;
        try {
          normalized = normalizeFeedItem(feed, item);
        } catch (error) {
          result.skipped += 1;
          result.errors.push(error instanceof Error ? error.message : String(error));
          continue;
        }

        if (!normalized) {
          result.skipped += 1;
          continue;
        }

        const saved = await articleRepository.insertDiscoveredArticle(normalized);
        if (saved.created) {
          result.created += 1;
          console.log({ source: feed.sourceName, url: normalized.canonicalUrl }, 'article_discovered');
        } else {
          result.duplicates += 1;
          console.log(
            { source: feed.sourceName, url: normalized.canonicalUrl },
            'article_skipped_duplicate'
          );
        }
      }

      await feedRepository.updateLastFetchedAt(feed.id);
      console.log({ source: feed.sourceName, fetched: result.fetched }, 'feed_fetched');
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    results.push(result);
  }

  return {
    feeds: results,
    fetched: results.reduce((sum, result) => sum + result.fetched, 0),
    created: results.reduce((sum, result) => sum + result.created, 0),
    duplicates: results.reduce((sum, result) => sum + result.duplicates, 0),
    skipped: results.reduce((sum, result) => sum + result.skipped, 0),
    errors: results.reduce((sum, result) => sum + result.errors.length, 0),
  };
}
