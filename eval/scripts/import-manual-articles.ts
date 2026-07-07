import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { getDatabasePool } from '../../src/db/pool.js';
import { FeedRepository } from '../../src/db/repositories/feed.repository.js';
import { ArticleRepository } from '../../src/db/repositories/article.repository.js';
import { decideCheapFilter } from '../../src/pipeline/filter-stage.js';
import { normalizeTitle, normalizeUrl } from '../../src/extraction/url-normalizer.js';
import { hashNormalizedValue } from '../../src/utils/hash.js';
import type { Queryable } from '../../src/db/repositories/types.js';
import {
  MANUAL_FEED_SOURCE_TYPE,
  MANUAL_FEED_URL,
  loadManualArticles,
  type ManualArticle,
} from '../utils/manualArticles.js';

export interface ImportManualArticlesOptions {
  runFilter: boolean;
}

export interface ImportSummary {
  imported: number;
  duplicates: number;
  filtered: Array<{ title: string; decision: string; score: number }>;
}

/**
 * Inserts hand-authored test articles into the pipeline database under a
 * dedicated inactive 'manual' feed (so ingest:rss never touches it), and
 * optionally runs the cheap filter on them immediately. They then appear in
 * the eval review UI's Live decisions tab, filterable by origin.
 */
export async function importManualArticles(
  db: Queryable,
  articles: ManualArticle[],
  options: ImportManualArticlesOptions
): Promise<ImportSummary> {
  const feeds = new FeedRepository(db);
  const articleRepository = new ArticleRepository(db);
  const manualFeed = await feeds.upsertFeed({
    sourceName: 'Manual Test Articles',
    feedUrl: MANUAL_FEED_URL,
    sourceType: MANUAL_FEED_SOURCE_TYPE,
    trustLevel: 'medium',
    isActive: false,
  });

  const summary: ImportSummary = { imported: 0, duplicates: 0, filtered: [] };

  for (const article of articles) {
    const canonicalUrl = normalizeUrl(article.url);
    const saved = await articleRepository.insertDiscoveredArticle({
      feedId: manualFeed.id,
      sourceName: article.sourceName,
      title: article.title,
      canonicalUrl,
      urlHash: hashNormalizedValue(canonicalUrl),
      titleHash: hashNormalizedValue(normalizeTitle(article.title)),
      rssSummary: article.rssSummary,
      rssCategories: article.rssCategories,
      publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
    });

    if (!saved.created) {
      summary.duplicates += 1;
      continue;
    }
    summary.imported += 1;

    if (options.runFilter) {
      const decision = decideCheapFilter({
        title: article.title,
        rssSummary: article.rssSummary,
        rssCategories: article.rssCategories,
        sourceName: article.sourceName,
        publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
      });
      await articleRepository.saveCheapFilterResult(saved.article.id, decision);
      await articleRepository.updateProcessingStatus(
        saved.article.id,
        decision.decision === 'KEEP'
          ? 'EXTRACTION_PENDING'
          : decision.decision === 'MAYBE_KEEP'
            ? 'EXTRACTION_PENDING_LOW_PRIORITY'
            : 'IGNORED',
        decision.decision === 'DROP' ? decision.blockingReasons.join(',') : undefined
      );
      summary.filtered.push({ title: article.title, decision: decision.decision, score: decision.score });
    }
  }

  return summary;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileArg = args.find((arg) => arg.startsWith('--file='));
  const path = fileArg ? fileArg.split('=')[1] : join(process.cwd(), 'eval/datasets/manual-articles.jsonl');
  const runFilter = !args.includes('--no-filter');

  const articles = await loadManualArticles(path);
  if (articles.length === 0) {
    console.log(`No articles found in ${path}.`);
    return;
  }

  const pool = getDatabasePool();
  try {
    const summary = await importManualArticles(pool, articles, { runFilter });
    console.log(`Imported ${summary.imported} article(s), skipped ${summary.duplicates} duplicate(s) from ${path}.`);
    for (const item of summary.filtered) {
      console.log(`  ${item.decision.padEnd(10)} score ${String(item.score).padStart(4)}  ${item.title}`);
    }
    if (!runFilter) {
      console.log('Filter not run (--no-filter). Articles are NEW; run: npm run filter:articles');
    }
    console.log('Review them in the Live decisions tab: npm run eval:review (origin: My articles).');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
