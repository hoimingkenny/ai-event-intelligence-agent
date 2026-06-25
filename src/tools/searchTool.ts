import { createHash } from 'node:crypto';
import Parser from 'rss-parser';
import type { RawArticle } from '../types/domain.js';
import { rssFeeds } from '../config/rssFeeds.js';
import { env } from '../config/env.js';

const parser = new Parser({
  timeout: 10_000,
  headers: { 'user-agent': 'vendor-threat-watch/0.1' },
});

function articleIdFor(url: string): string {
  return `rss_${createHash('sha1').update(url).digest('hex').slice(0, 12)}`;
}

function isFresh(pubDate: string | undefined, lookbackHours: number): boolean {
  if (!pubDate) return true; // Unknown date — keep rather than silently drop.
  const published = new Date(pubDate).getTime();
  if (Number.isNaN(published)) return true;
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  return published >= cutoff;
}

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

function matchesQuery(title: string, snippet: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = `${title} ${snippet}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

async function fetchFeed(url: string): Promise<RawArticle[]> {
  const feed = await parser.parseURL(url);
  return feed.items
    .filter((item) => item.link && item.title)
    .map((item) => ({
      id: articleIdFor(item.link as string),
      title: item.title as string,
      url: item.link as string,
      source: feed.title ?? new URL(url).hostname,
      snippet: item.contentSnippet ?? item.summary ?? '',
      publishedAt: item.pubDate ?? item.isoDate,
      retrievedAt: new Date().toISOString(),
      query: url,
    }));
}

export async function runCyberWebSearch(query: string): Promise<RawArticle[]> {
  const results = await Promise.allSettled(rssFeeds.map((f) => fetchFeed(f.url)));
  const articles: RawArticle[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      articles.push(...result.value);
    }
    // Silently skip failed feeds; surfaced via the surrounding pipeline if zero results come back.
  }

  // Dedupe by article id (URL hash) and apply query + freshness filters.
  const seen = new Set<string>();
  const terms = queryTerms(query);
  const filtered = articles.filter((article) => {
    if (seen.has(article.id)) return false;
    seen.add(article.id);
    if (!isFresh(article.publishedAt, env.monitorLookbackHours)) return false;
    return matchesQuery(article.title, article.snippet ?? '', terms);
  });

  // Sort newest first.
  filtered.sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });

  return filtered;
}
