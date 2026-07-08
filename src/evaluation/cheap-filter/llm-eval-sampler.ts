import type { Queryable } from '../../db/repositories/types.js';
import { inferSourceTier } from '../../pipeline/filter-stage.js';
import {
  CheapFilterEvalInputSchema,
  type CheapFilterEvalInput,
  type SourceTier,
} from './llm-eval-types.js';

export interface SampleOptions {
  sampleSize: number;
  sinceDays: number;
  sourceTier?: SourceTier;
  decision?: 'KEEP' | 'MAYBE_KEEP' | 'DROP';
  /** Random within bucket when true; deterministic newest-first otherwise. */
  random?: boolean;
}

export interface SampleBucketReport {
  bucket: 'critical_like' | 'relevant_like' | 'borderline_like' | 'irrelevant_like';
  requested: number;
  found: number;
}

export interface SampleReport {
  totalSampled: number;
  buckets: SampleBucketReport[];
}

interface ArticleRow {
  id: string;
  title: string | null;
  rss_summary: string | null;
  rss_categories: string[] | null;
  source_name: string | null;
  published_at: Date | null;
  cheap_filter_decision: string | null;
  cheap_filter_score: number | string | null;
  cheap_filter_matched_signals: CheapFilterMatchedSignalsRaw | null;
  cheap_filter_blocking_reasons: string[] | null;
  cheap_filter_reasons: string[] | null;
}

interface CheapFilterMatchedSignalsRaw {
  criticalCyberKeywords?: string[];
  mediumCyberKeywords?: string[];
  lowCyberKeywords?: string[];
  negativeKeywords?: string[];
  cves?: string[];
  vendors?: string[];
  products?: string[];
  rssCategories?: string[];
  sourceTier?: SourceTier;
}

const SOURCE_TIER_VALUES = ['official_vendor', 'government_cert', 'security_media', 'researcher_blog', 'general_news', 'unknown'] as const;

function isSourceTier(value: unknown): value is SourceTier {
  return typeof value === 'string' && (SOURCE_TIER_VALUES as readonly string[]).includes(value);
}

// Each bucket has an explicit SQL predicate. Buckets are mutually exclusive
// (priority order: critical_like > borderline_like > relevant_like > irrelevant_like).
//
// The matched_signals column is JSONB. We extract the critical/medium keyword
// counts inline so the predicate can reason about signal strength without
// loading the full matched_signals object.

const SELECT_COLUMNS = `
  id, title, rss_summary, rss_categories, source_name, published_at,
  cheap_filter_decision, cheap_filter_score,
  cheap_filter_matched_signals, cheap_filter_blocking_reasons, cheap_filter_reasons
`;

function buildBaseWhere(options: SampleOptions): { sql: string; params: unknown[] } {
  const filters: string[] = [
    `cheap_filter_decision IS NOT NULL`,
    `cheap_filter_score IS NOT NULL`,
    `cheap_filter_matched_signals IS NOT NULL`,
    `fetched_at > now() - make_interval(days => $1)`,
  ];
  const params: unknown[] = [options.sinceDays];

  if (options.decision) {
    params.push(options.decision);
    filters.push(`cheap_filter_decision = $${params.length}`);
  }

  return { sql: filters.join(' AND '), params };
}

async function runBucket(
  db: Queryable,
  bucket: 'critical_like' | 'relevant_like' | 'borderline_like' | 'irrelevant_like',
  options: SampleOptions,
  limit: number
): Promise<{ rows: ArticleRow[] }> {
  const { sql: whereSql, params } = buildBaseWhere(options);

  let bucketSql = '';
  const bucketParams: unknown[] = [...params];
  switch (bucket) {
    case 'critical_like':
      // KEEP with a strong urgent signal: CVE, critical keyword, or score >= 80.
      bucketSql = `
        AND cheap_filter_decision = 'KEEP'
        AND (
          jsonb_array_length(cheap_filter_matched_signals->'cves') > 0
          OR jsonb_array_length(cheap_filter_matched_signals->'criticalCyberKeywords') > 0
          OR cheap_filter_score >= 80
        )
      `;
      break;
    case 'borderline_like':
      // MAYBE_KEEP regardless of score band. Always low-priority.
      bucketSql = `AND cheap_filter_decision = 'MAYBE_KEEP'`;
      break;
    case 'relevant_like':
      // KEEP without a critical signal — medium keyword, vendor + medium,
      // trusted source boost, or score 40–79.
      bucketSql = `
        AND cheap_filter_decision = 'KEEP'
        AND jsonb_array_length(cheap_filter_matched_signals->'cves') = 0
        AND jsonb_array_length(cheap_filter_matched_signals->'criticalCyberKeywords') = 0
        AND cheap_filter_score < 80
        AND (
          jsonb_array_length(cheap_filter_matched_signals->'mediumCyberKeywords') > 0
          OR cheap_filter_matched_signals->>'sourceTier' IN ('official_vendor', 'government_cert', 'security_media')
          OR cheap_filter_score >= 40
        )
      `;
      break;
    case 'irrelevant_like':
      // DROP. Includes both low-score and insufficient-signal drops.
      bucketSql = `AND cheap_filter_decision = 'DROP'`;
      break;
  }

  const orderSql = options.random
    ? 'ORDER BY random()'
    : 'ORDER BY published_at DESC NULLS LAST, fetched_at DESC, id DESC';

  const sql = `
    SELECT ${SELECT_COLUMNS}
    FROM articles
    WHERE ${whereSql} ${bucketSql}
    ${orderSql}
    LIMIT $${bucketParams.length + 1}
  `;
  bucketParams.push(limit);

  const result = await db.query<ArticleRow>(sql, bucketParams);
  return { rows: result.rows };
}

function rowToInput(row: ArticleRow): CheapFilterEvalInput | null {
  if (!row.id || !row.title) return null;
  if (!row.cheap_filter_decision || row.cheap_filter_score == null) return null;
  if (!isCheapFilterDecision(row.cheap_filter_decision)) return null;

  const signals = row.cheap_filter_matched_signals ?? {};
  // The cheap filter records the inferred tier inside matched_signals; fall
  // back to inferring from source_name so the LLM sees the same value the
  // filter used.
  const tierCandidate = signals.sourceTier ?? inferSourceTier(row.source_name);
  const sourceTier = isSourceTier(tierCandidate) ? tierCandidate : 'unknown';

  const input = {
    articleId: row.id,
    title: row.title,
    rssSummary: row.rss_summary,
    rssCategories: row.rss_categories ?? signals.rssCategories ?? [],
    sourceName: row.source_name,
    sourceTier,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    cheapFilterDecision: row.cheap_filter_decision,
    cheapFilterScore: Number(row.cheap_filter_score),
    matchedSignals: {
      criticalCyberKeywords: signals.criticalCyberKeywords ?? [],
      mediumCyberKeywords: signals.mediumCyberKeywords ?? [],
      lowCyberKeywords: signals.lowCyberKeywords ?? [],
      negativeKeywords: signals.negativeKeywords ?? [],
      cves: signals.cves ?? [],
      vendors: signals.vendors ?? [],
      products: signals.products ?? [],
      rssCategories: signals.rssCategories ?? [],
      sourceTier,
    },
    blockingReasons: row.cheap_filter_blocking_reasons ?? [],
  };

  const parsed = CheapFilterEvalInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

function isCheapFilterDecision(value: string): value is 'KEEP' | 'MAYBE_KEEP' | 'DROP' {
  return value === 'KEEP' || value === 'MAYBE_KEEP' || value === 'DROP';
}

const BUCKET_ORDER: Array<'critical_like' | 'relevant_like' | 'borderline_like' | 'irrelevant_like'> = [
  'critical_like',
  'borderline_like',
  'relevant_like',
  'irrelevant_like',
];

export async function sampleCheapFilterEvalArticles(
  db: Queryable,
  options: SampleOptions
): Promise<{ inputs: CheapFilterEvalInput[]; report: SampleReport }> {
  const perBucket = Math.ceil(options.sampleSize / 4);
  // 20% slack per bucket to absorb shortfalls without re-querying.
  const perBucketLimit = Math.ceil(perBucket * 1.2);

  const bucketReports: SampleBucketReport[] = [];
  const inputs: CheapFilterEvalInput[] = [];
  const seen = new Set<string>();

  for (const bucket of BUCKET_ORDER) {
    const { rows } = await runBucket(db, bucket, options, perBucketLimit);
    let bucketAdded = 0;
    for (const row of rows) {
      if (bucketAdded >= perBucket) break;
      if (seen.has(row.id)) continue;
      const input = rowToInput(row);
      if (!input) continue;
      seen.add(row.id);
      inputs.push(input);
      bucketAdded += 1;
    }
    bucketReports.push({ bucket, requested: perBucket, found: bucketAdded });
  }

  return {
    inputs,
    report: {
      totalSampled: inputs.length,
      buckets: bucketReports,
    },
  };
}