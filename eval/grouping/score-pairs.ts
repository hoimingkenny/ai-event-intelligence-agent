/**
 * Score grouping-pair labels with article↔article cosine distance from current-model embeddings.
 */

import { currentEmbeddingProvenance } from '../../src/config/embeddings.js';
import type { Queryable } from '../../src/db/repositories/types.js';
import type { GroupingPairLabelRecord } from './pair-dataset.js';
import type { ScoredGroupingPair } from './pair-metrics.js';

export function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

function parseVector(raw: string | null): number[] | null {
  if (!raw) return null;
  const values = raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(Number);
  if (values.length === 0 || values.some((n) => !Number.isFinite(n))) return null;
  return values;
}

async function loadEligibleEmbeddingByUrl(
  db: Queryable,
  url: string,
  model: string,
  dims: number
): Promise<{ articleId: string; title: string; sourceName: string; vector: number[] } | null> {
  const result = await db.query<{
    id: string;
    title: string | null;
    source_name: string | null;
    embedding: string | null;
  }>(
    `
      SELECT id, title, source_name, embedding::text AS embedding
      FROM articles
      WHERE canonical_url = $1
        AND embedding IS NOT NULL
        AND embedding_model = $2
        AND embedding_dims = $3
      LIMIT 1
    `,
    [url, model, dims]
  );
  const row = result.rows[0];
  if (!row) return null;
  const vector = parseVector(row.embedding);
  if (!vector) return null;
  return {
    articleId: row.id,
    title: row.title ?? url,
    sourceName: row.source_name ?? 'unknown',
    vector,
  };
}

async function loadArticleMetaByUrl(
  db: Queryable,
  url: string
): Promise<{ articleId: string; title: string; sourceName: string } | null> {
  const result = await db.query<{
    id: string;
    title: string | null;
    source_name: string | null;
  }>(
    `
      SELECT id, title, source_name
      FROM articles
      WHERE canonical_url = $1
      LIMIT 1
    `,
    [url]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    articleId: row.id,
    title: row.title ?? url,
    sourceName: row.source_name ?? 'unknown',
  };
}

export async function scoreGroupingPairs(
  db: Queryable,
  pairs: GroupingPairLabelRecord[]
): Promise<ScoredGroupingPair[]> {
  const { model, dims } = currentEmbeddingProvenance();
  const scored: ScoredGroupingPair[] = [];

  for (const pair of pairs) {
    const [left, right] = await Promise.all([
      loadEligibleEmbeddingByUrl(db, pair.urlA, model, dims),
      loadEligibleEmbeddingByUrl(db, pair.urlB, model, dims),
    ]);

    let distance: number | null = null;
    let titleA = pair.titleA;
    let titleB = pair.titleB;
    let sourceNameA = pair.sourceNameA;
    let sourceNameB = pair.sourceNameB;

    if (left && right) {
      distance = cosineDistance(left.vector, right.vector);
      titleA = left.title;
      titleB = right.title;
      sourceNameA = left.sourceName;
      sourceNameB = right.sourceName;
    } else {
      const [metaA, metaB] = await Promise.all([
        left ? null : loadArticleMetaByUrl(db, pair.urlA),
        right ? null : loadArticleMetaByUrl(db, pair.urlB),
      ]);
      if (left) {
        titleA = left.title;
        sourceNameA = left.sourceName;
      } else if (metaA) {
        titleA = metaA.title;
        sourceNameA = metaA.sourceName;
      }
      if (right) {
        titleB = right.title;
        sourceNameB = right.sourceName;
      } else if (metaB) {
        titleB = metaB.title;
        sourceNameB = metaB.sourceName;
      }
    }

    scored.push({
      urlA: pair.urlA,
      urlB: pair.urlB,
      label: pair.label,
      humanReason: pair.humanReason,
      distance,
      goldIncidentId: pair.goldIncidentId ?? null,
      titleA,
      titleB,
      sourceNameA,
      sourceNameB,
    });
  }

  return scored;
}

export async function searchArticlesForPicker(
  db: Queryable,
  query: string,
  limit = 30
): Promise<
  Array<{
    articleId: string;
    url: string;
    title: string;
    sourceName: string;
    hasCurrentEmbedding: boolean;
  }>
> {
  const { model, dims } = currentEmbeddingProvenance();
  const q = query.trim();
  const result = await db.query<{
    id: string;
    canonical_url: string | null;
    title: string | null;
    source_name: string | null;
    has_embedding: boolean;
  }>(
    `
      SELECT
        id,
        canonical_url,
        title,
        source_name,
        (embedding IS NOT NULL AND embedding_model = $2 AND embedding_dims = $3) AS has_embedding
      FROM articles
      WHERE canonical_url IS NOT NULL
        AND (
          $1 = ''
          OR title ILIKE '%' || $1 || '%'
          OR canonical_url ILIKE '%' || $1 || '%'
          OR source_name ILIKE '%' || $1 || '%'
        )
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      LIMIT $4
    `,
    [q, model, dims, limit]
  );

  return result.rows
    .filter((row) => row.canonical_url)
    .map((row) => ({
      articleId: row.id,
      url: row.canonical_url as string,
      title: row.title ?? (row.canonical_url as string),
      sourceName: row.source_name ?? 'unknown',
      hasCurrentEmbedding: Boolean(row.has_embedding),
    }));
}
