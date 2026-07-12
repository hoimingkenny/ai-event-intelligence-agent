import type { Queryable } from '../db/repositories/types.js';
import { env } from '../config/env.js';
import { createEmbeddingLifecycle } from '../embedding/lifecycle.js';
import type { EmbeddingClient } from '../embedding/embedding-client.js';

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
  const lifecycle = createEmbeddingLifecycle(db);
  return lifecycle.embedArticles({
    limit: options.limit,
    client: options.client,
    minTextLength: options.minTextLength,
    batchSize: options.batchSize ?? env.embeddingBatchSize,
  });
}
