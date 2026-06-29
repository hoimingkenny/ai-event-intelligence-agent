import { getDatabasePool } from '../src/db/pool.js';
import { ingestRssFeeds } from '../src/pipeline/ingest-stage.js';

const limitArg = process.argv.find((arg) => arg.startsWith('--limit-feeds='));
const limitFeeds = limitArg ? Number(limitArg.split('=')[1]) : undefined;
const feedUrlArgs = process.argv
  .filter((arg) => arg.startsWith('--feed-url='))
  .map((arg) => arg.slice('--feed-url='.length))
  .filter(Boolean);

async function main(): Promise<void> {
  const pool = getDatabasePool();

  try {
    const result = await ingestRssFeeds(pool, {
      feedUrls: feedUrlArgs.length > 0 ? feedUrlArgs : undefined,
      limitFeeds: Number.isFinite(limitFeeds) ? limitFeeds : undefined,
    });

    console.log(
      JSON.stringify(
        {
          fetched: result.fetched,
          created: result.created,
          duplicates: result.duplicates,
          skipped: result.skipped,
          errors: result.errors,
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

await main();
