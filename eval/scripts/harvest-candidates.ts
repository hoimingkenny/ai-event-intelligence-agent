import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { getDatabasePool } from '../../src/db/pool.js';
import { inferSourceTier } from '../../src/pipeline/filter-stage.js';
import { loadCheapFilterDataset } from '../utils/datasetLoader.js';
import { loadCandidates, writeCandidates } from '../utils/candidateStore.js';
import { deriveSampleId } from '../utils/derive.js';
import type { Queryable } from '../../src/db/repositories/types.js';
import type { CheapFilterDecision } from '../../src/pipeline/filter-stage.js';
import type { CheapFilterCandidate } from '../types/cheap-filter-eval.types.js';

export interface HarvestOptions {
  datasetPath: string;
  candidatesPath: string;
  days: number;
  keep: number;
  maybeKeep: number;
  drop: number;
}

export interface HarvestSummary {
  added: number;
  skippedAlreadyLabeled: number;
  skippedAlreadyCandidate: number;
  totalCandidates: number;
  byDecision: Record<CheapFilterDecision, number>;
}

interface CandidateRow {
  source_name: string | null;
  title: string | null;
  canonical_url: string | null;
  rss_summary: string | null;
  rss_categories: string[] | null;
  published_at: Date | null;
  cheap_filter_decision: string;
  cheap_filter_score: number | string | null;
}

/**
 * Harvests recent, already-filtered articles from the pipeline database as
 * pre-filled labeling candidates, stratified by cheap-filter decision.
 * DROP candidates are sampled highest-score-first so near-misses (the most
 * informative false-negative candidates) surface before obvious noise.
 */
export async function harvestCandidates(db: Queryable, options: HarvestOptions): Promise<HarvestSummary> {
  const [dataset, existingCandidates] = await Promise.all([
    loadDatasetUrls(options.datasetPath),
    loadCandidates(options.candidatesPath),
  ]);
  const candidateUrls = new Set(existingCandidates.map((candidate) => candidate.url));
  const harvestedAt = new Date().toISOString();
  const summary: HarvestSummary = {
    added: 0,
    skippedAlreadyLabeled: 0,
    skippedAlreadyCandidate: 0,
    totalCandidates: 0,
    byDecision: { KEEP: 0, MAYBE_KEEP: 0, DROP: 0 },
  };

  const strata: Array<{ decision: CheapFilterDecision; limit: number }> = [
    { decision: 'KEEP', limit: options.keep },
    { decision: 'MAYBE_KEEP', limit: options.maybeKeep },
    { decision: 'DROP', limit: options.drop },
  ];

  const merged = [...existingCandidates];
  for (const stratum of strata) {
    if (stratum.limit <= 0) continue;
    // Over-fetch so we can still fill the stratum after skipping known URLs.
    const rows = await queryStratum(db, stratum.decision, options.days, stratum.limit * 3);
    let taken = 0;
    for (const row of rows) {
      if (taken >= stratum.limit) break;
      if (!row.canonical_url || !row.title) continue;
      if (dataset.has(row.canonical_url)) {
        summary.skippedAlreadyLabeled += 1;
        continue;
      }
      if (candidateUrls.has(row.canonical_url)) {
        summary.skippedAlreadyCandidate += 1;
        continue;
      }
      const candidate = toCandidate(row, harvestedAt);
      merged.push(candidate);
      candidateUrls.add(candidate.url);
      summary.added += 1;
      summary.byDecision[stratum.decision] += 1;
      taken += 1;
    }
  }

  await writeCandidates(options.candidatesPath, merged);
  summary.totalCandidates = merged.length;
  return summary;
}

async function queryStratum(
  db: Queryable,
  decision: CheapFilterDecision,
  days: number,
  limit: number
): Promise<CandidateRow[]> {
  const order =
    decision === 'DROP'
      ? 'ORDER BY cheap_filter_score DESC NULLS LAST, random()'
      : 'ORDER BY random()';
  const result = await db.query<CandidateRow>(
    `
      SELECT source_name, title, canonical_url, rss_summary, rss_categories,
             published_at, cheap_filter_decision, cheap_filter_score
      FROM articles
      WHERE cheap_filter_decision = $1
        AND canonical_url IS NOT NULL
        AND title IS NOT NULL
        AND COALESCE(published_at, created_at) >= NOW() - make_interval(days => $2)
      ${order}
      LIMIT $3
    `,
    [decision, days, limit]
  );
  return result.rows;
}

function toCandidate(row: CandidateRow, harvestedAt: string): CheapFilterCandidate {
  const url = row.canonical_url as string;
  return {
    id: deriveSampleId(url),
    sourceName: row.source_name ?? 'unknown',
    sourceTier: inferSourceTier(row.source_name),
    url,
    title: row.title as string,
    rssSummary: row.rss_summary,
    rssCategories: row.rss_categories ?? [],
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    harvest: {
      decision: row.cheap_filter_decision as CheapFilterDecision,
      score: row.cheap_filter_score == null ? null : Number(row.cheap_filter_score),
      harvestedAt,
    },
  };
}

async function loadDatasetUrls(datasetPath: string): Promise<Set<string>> {
  try {
    const samples = await loadCheapFilterDataset(datasetPath);
    return new Set(samples.map((sample) => sample.url));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
}

function parseArgs(args: string[]): HarvestOptions {
  return {
    datasetPath: readOption(args, '--dataset') ?? join(process.cwd(), 'eval/datasets/cheap-filter-eval.jsonl'),
    candidatesPath: readOption(args, '--out') ?? join(process.cwd(), 'eval/datasets/cheap-filter-candidates.jsonl'),
    days: readNumber(args, '--days', 14),
    keep: readNumber(args, '--keep', 15),
    maybeKeep: readNumber(args, '--maybe', 15),
    drop: readNumber(args, '--drop', 20),
  };
}

function readOption(args: string[], name: string): string | null {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] ?? null;
  return null;
}

function readNumber(args: string[], name: string, fallback: number): number {
  const value = Number(readOption(args, name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = getDatabasePool();
  try {
    const summary = await harvestCandidates(pool, options);
    console.log(
      [
        `Added ${summary.added} candidate(s) (KEEP ${summary.byDecision.KEEP}, MAYBE_KEEP ${summary.byDecision.MAYBE_KEEP}, DROP ${summary.byDecision.DROP}).`,
        `Skipped ${summary.skippedAlreadyLabeled} already labeled, ${summary.skippedAlreadyCandidate} already pending.`,
        `Candidates file now has ${summary.totalCandidates} record(s): ${options.candidatesPath}`,
        `Label them with: npm run eval:review`,
      ].join('\n')
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
