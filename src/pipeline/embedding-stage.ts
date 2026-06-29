import { ArticleRepository } from '../db/repositories/article.repository.js';
import type { Queryable } from '../db/repositories/types.js';
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
  options: { limit?: number; client?: EmbeddingClient; minTextLength?: number } = {}
): Promise<EmbeddingStageResult> {
  const articles = new ArticleRepository(db);
  const candidates = await articles.listByProcessingStatus('ENTITY_EXTRACTED', options.limit ?? 20);
  const client = options.client ?? new MiniMaxEmbeddingClient();
  const minTextLength = options.minTextLength ?? 100;
  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  for (const article of candidates) {
    const text = buildArticleEmbeddingText(article);
    if (text.length < minTextLength) {
      await articles.updateProcessingStatus(article.id, 'IGNORED', 'embedding_text_too_short');
      skipped += 1;
      continue;
    }

    try {
      const vector = await client.embedDocument(text);
      await articles.saveEmbedding(article.id, vector);
      embedded += 1;
    } catch (error) {
      await articles.updateProcessingStatus(
        article.id,
        'EMBEDDING_PENDING',
        error instanceof Error ? error.message : String(error)
      );
      failed += 1;
    }
  }

  return {
    reviewed: candidates.length,
    embedded,
    skipped,
    failed,
  };
}
