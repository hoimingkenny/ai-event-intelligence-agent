import { ArticleRepository, type ArticleRecord } from '../db/repositories/article.repository.js';
import type { Queryable } from '../db/repositories/types.js';

export type CveMentionZone = 'title' | 'rss_summary' | 'clean_text' | 'source_link';

export const CVE_MENTION_ZONES: ReadonlyArray<CveMentionZone> = [
  'title',
  'rss_summary',
  'clean_text',
  'source_link',
];

export interface CveMentionRow {
  articleId: string;
  cveId: string;
  zone: CveMentionZone;
  snippet: string;
  startOffset: number;
  endOffset: number;
}

export interface ScanResult {
  articleId: string;
  mentions: CveMentionRow[];
  cveIds: string[];
  sourceLinksScanned: number;
}

const CVE_PATTERN = /\bCVE-\d{4}-\d{4,}\b/gi;
const SNIPPET_RADIUS = 60;

function findMentionsInText(text: string, zone: CveMentionZone, articleId: string): CveMentionRow[] {
  if (!text) return [];
  const out: CveMentionRow[] = [];
  const seenInZone = new Set<string>();
  for (const match of text.matchAll(CVE_PATTERN)) {
    const cveId = match[0].toUpperCase();
    const dedupeKey = `${cveId}:${zone}`;
    if (seenInZone.has(dedupeKey)) continue;
    seenInZone.add(dedupeKey);
    const start = match.index ?? 0;
    const end = start + match[0].length;
    out.push({
      articleId,
      cveId,
      zone,
      snippet: extractSnippet(text, start, end),
      startOffset: start,
      endOffset: end,
    });
  }
  return out;
}

function extractSnippet(text: string, start: number, end: number): string {
  const lo = Math.max(0, start - SNIPPET_RADIUS);
  const hi = Math.min(text.length, end + SNIPPET_RADIUS);
  let raw = text.slice(lo, hi);
  if (lo > 0) {
    const firstSpace = raw.indexOf(' ');
    raw = (firstSpace > 0 ? raw.slice(firstSpace + 1) : raw).trimStart();
  }
  if (hi < text.length) {
    const lastSpace = raw.lastIndexOf(' ');
    raw = (lastSpace > 0 ? raw.slice(0, lastSpace) : raw).trimEnd();
  }
  return raw;
}

function collectSourceLinkTexts(article: ArticleRecord): string[] {
  const texts: string[] = [];
  if (article.canonicalUrl) texts.push(article.canonicalUrl);
  return texts;
}

export function scanArticleForCves(article: ArticleRecord): ScanResult {
  const mentions: CveMentionRow[] = [];
  mentions.push(...findMentionsInText(article.title ?? '', 'title', article.id));
  mentions.push(...findMentionsInText(article.rssSummary ?? '', 'rss_summary', article.id));
  const cleanText = article.cleanText ?? '';
  if (cleanText) {
    mentions.push(...findMentionsInText(cleanText, 'clean_text', article.id));
  }
  const sourceLinks = collectSourceLinkTexts(article);
  for (const link of sourceLinks) {
    mentions.push(...findMentionsInText(link, 'source_link', article.id));
  }

  const cveIds = Array.from(new Set(mentions.map((m) => m.cveId))).sort();
  return {
    articleId: article.id,
    mentions,
    cveIds,
    sourceLinksScanned: sourceLinks.length,
  };
}

export async function persistCveMentions(db: Queryable, mentions: CveMentionRow[]): Promise<void> {
  if (mentions.length === 0) return;
  const repo = new ArticleRepository(db);
  for (const articleId of Array.from(new Set(mentions.map((m) => m.articleId)))) {
    await repo.deleteCveMentionsForArticle(articleId);
  }
  await repo.insertCveMentions(mentions);
}