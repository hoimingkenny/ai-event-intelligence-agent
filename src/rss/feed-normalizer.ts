import type { FeedRecord } from '../db/repositories/feed.repository.js';
import { normalizeTitle, normalizeUrl } from '../extraction/url-normalizer.js';
import { hashNormalizedValue } from '../utils/hash.js';
import type { FetchedFeedItem } from './rss-fetcher.js';

export interface NormalizedFeedItem {
  feedId: string;
  sourceName: string;
  title: string;
  canonicalUrl: string;
  urlHash: string;
  titleHash: string;
  rssSummary: string | null;
  rssCategories: string[];
  publishedAt: Date | null;
}

export function normalizeFeedItem(
  feed: FeedRecord,
  item: FetchedFeedItem
): NormalizedFeedItem | null {
  const rawUrl = item.link || item.guid;
  if (!rawUrl) return null;

  const rawTitle = item.title?.trim() || rawUrl;
  const canonicalUrl = normalizeUrl(rawUrl);
  const normalizedTitle = normalizeTitle(rawTitle);
  const rssSummary = normalizeSummary(item.contentSnippet || item.content || null);
  const rssCategories = normalizeCategories(item.categories ?? []);

  return {
    feedId: feed.id,
    sourceName: feed.sourceName,
    title: rawTitle,
    canonicalUrl,
    urlHash: hashNormalizedValue(canonicalUrl),
    titleHash: hashNormalizedValue(normalizedTitle),
    rssSummary,
    rssCategories,
    publishedAt: parseFeedDate(item.isoDate || item.pubDate),
  };
}

export function parseFeedDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeSummary(summary: string | null): string | null {
  if (!summary) return null;
  const trimmed = summary.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCategories(categories: string[]): string[] {
  return Array.from(
    new Set(
      categories
        .map((category) => category.replace(/\s+/g, ' ').trim())
        .filter((category) => category.length > 0)
    )
  );
}
