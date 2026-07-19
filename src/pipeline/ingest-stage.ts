import { ArticleRepository } from '../db/repositories/article.repository.js';
import { FeedRepository, type FeedRecord } from '../db/repositories/feed.repository.js';
import { normalizeFeedItem, type NormalizedFeedItem } from '../rss/feed-normalizer.js';
import { ParserRssFetcher, type RssFetcher } from '../rss/rss-fetcher.js';
import type { Queryable } from '../db/repositories/types.js';
import { logInfo, logStageArticle } from '../utils/logger.js';

type PreparedItem = {
  feedOrdinal: number;
  itemIndex: number;
  feedResult: IngestFeedResult;
  normalized: NormalizedFeedItem;
};

/** Oldest published_at first; nulls last; feed list order then item index as tie-break. */
function compareForIngestOrder(a: PreparedItem, b: PreparedItem): number {
  const aTime = a.normalized.publishedAt?.getTime();
  const bTime = b.normalized.publishedAt?.getTime();
  if (aTime === undefined && bTime === undefined) {
    return a.feedOrdinal - b.feedOrdinal || a.itemIndex - b.itemIndex;
  }
  if (aTime === undefined) return 1;
  if (bTime === undefined) return -1;
  if (aTime !== bTime) return aTime - bTime;
  return a.feedOrdinal - b.feedOrdinal || a.itemIndex - b.itemIndex;
}

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
  const prepared: PreparedItem[] = [];
  const fetchedOk = new Set<string>();

  for (let feedOrdinal = 0; feedOrdinal < feeds.length; feedOrdinal += 1) {
    const feed = feeds[feedOrdinal];
    const { result, fetchSucceeded } = await collectFeedItems(feed, feedOrdinal, fetcher, prepared);
    results.push(result);
    if (fetchSucceeded) fetchedOk.add(result.feedId);
  }

  prepared.sort(compareForIngestOrder);

  for (const item of prepared) {
    const saved = await articleRepository.insertDiscoveredArticle(item.normalized);
    if (saved.created) {
      item.feedResult.created += 1;
      logStageArticle('ingest', saved.article.id, 'discovered', {
        source: item.feedResult.sourceName,
        url: item.normalized.canonicalUrl,
      });
    } else {
      item.feedResult.duplicates += 1;
      logStageArticle('ingest', saved.article.id, 'skipped_duplicate', {
        source: item.feedResult.sourceName,
        url: item.normalized.canonicalUrl,
      });
    }
  }

  for (const result of results) {
    if (!fetchedOk.has(result.feedId)) continue;
    await feedRepository.updateLastFetchedAt(result.feedId);
    logInfo({ source: result.sourceName, fetched: result.fetched }, 'feed_fetched');
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

async function collectFeedItems(
  feed: FeedRecord,
  feedOrdinal: number,
  fetcher: RssFetcher,
  prepared: PreparedItem[]
): Promise<{ result: IngestFeedResult; fetchSucceeded: boolean }> {
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

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
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

      prepared.push({ feedOrdinal, itemIndex, feedResult: result, normalized });
    }

    return { result, fetchSucceeded: true };
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    return { result, fetchSucceeded: false };
  }
}
