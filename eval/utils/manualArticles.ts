import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * A hand-authored test article for exercising the cheap filter with content
 * the live feeds rarely produce (e.g. explicit monitored vendor/product
 * mentions). Only sourceName, url, and title are required.
 */
export const ManualArticleSchema = z.object({
  sourceName: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  rssSummary: z.string().nullable().optional().default(null),
  rssCategories: z.array(z.string()).optional().default([]),
  publishedAt: z.string().datetime().nullable().optional().default(null),
});

export type ManualArticle = z.infer<typeof ManualArticleSchema>;

export const MANUAL_FEED_URL = 'manual://test-articles';
export const MANUAL_FEED_SOURCE_TYPE = 'manual';

export async function loadManualArticles(path: string): Promise<ManualArticle[]> {
  const raw = await readFile(path, 'utf8');
  const articles: ManualArticle[] = [];
  const seenUrls = new Map<string, number>();

  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid manual article JSON on line ${index + 1}: ${(error as Error).message}`);
    }
    const result = ManualArticleSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid manual article on line ${index + 1}: ${result.error.message}`);
    }
    const duplicateLine = seenUrls.get(result.data.url);
    if (duplicateLine !== undefined) {
      throw new Error(`Duplicate manual article url "${result.data.url}" on line ${index + 1} (first seen on line ${duplicateLine}).`);
    }
    seenUrls.set(result.data.url, index + 1);
    articles.push(result.data);
  });

  return articles;
}
