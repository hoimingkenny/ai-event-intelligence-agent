import { ArticleRepository } from '../db/repositories/article.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { env } from '../config/env.js';
import {
  buildArticleEmbeddingText,
  MiniMaxEmbeddingClient,
  type EmbeddingClient,
} from '../embedding/embedding-client.js';

export interface EmbeddingStageResult {
  reviewed: number;
  embedded: number;
  skipped: number;
  failed: number;
}

export async function runEmbeddingStage(
  db: Queryable,
  options: { limit?: number; client?: EmbeddingClient; minTextLength?: number; batchSize?: number } = {}
): Promise<EmbeddingStageResult> {
  const articles = new ArticleRepository(db);
  const candidates = await articles.listByProcessingStatuses(
    ['ENTITY_EXTRACTED', 'EMBEDDING_PENDING'],
    options.limit ?? 20
  );
  const client = options.client ?? new MiniMaxEmbeddingClient();
  const minTextLength = options.minTextLength ?? 100;
  const batchSize = Math.max(1, options.batchSize ?? env.embeddingBatchSize);
  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  const eligible: Array<{ id: string; text: string }> = [];

  for (const article of candidates) {
    const text = buildArticleEmbeddingText(article);
    if (text.length < minTextLength) {
      await articles.updateProcessingStatus(article.id, 'IGNORED', 'embedding_text_too_short');
      skipped += 1;
      continue;
    }

    eligible.push({ id: article.id, text });
  }

  for (const batch of chunk(eligible, batchSize)) {
    let vectors: number[][];
    try {
      vectors = await client.embedDocuments(batch.map((item) => item.text));
      if (vectors.length !== batch.length) {
        throw new Error(`Embedding response count mismatch: expected ${batch.length}, got ${vectors.length}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const item of batch) {
        await articles.updateProcessingStatus(item.id, 'EMBEDDING_PENDING', message);
        failed += 1;
      }
      continue;
    }

    for (const [index, item] of batch.entries()) {
      const vector = vectors[index];
      try {
        if (!vector) {
          throw new Error(`Embedding response missing vector at index ${index}`);
        }
        await articles.saveEmbedding(item.id, vector);
        embedded += 1;
      } catch (error) {
        await articles.updateProcessingStatus(
          item.id,
          'EMBEDDING_PENDING',
          error instanceof Error ? error.message : String(error)
        );
        failed += 1;
      }
    }
  }

  return {
    reviewed: candidates.length,
    embedded,
    skipped,
    failed,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
