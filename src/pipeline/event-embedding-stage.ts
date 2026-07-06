import { EventRepository } from '../db/repositories/event.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { env } from '../config/env.js';
import {
  buildEventEmbeddingText,
  MiniMaxEmbeddingClient,
  type EmbeddingClient,
} from '../embedding/embedding-client.js';

export interface EventEmbeddingStageResult {
  reviewed: number;
  embedded: number;
  skipped: number;
  failed: number;
}

export async function runEventEmbeddingStage(
  db: Queryable,
  options: { limit?: number; client?: EmbeddingClient; minTextLength?: number; batchSize?: number } = {}
): Promise<EventEmbeddingStageResult> {
  const events = new EventRepository(db);
  const candidates = await events.listEventsMissingEmbedding(options.limit ?? 20);
  const client = options.client ?? new MiniMaxEmbeddingClient();
  const minTextLength = options.minTextLength ?? 20;
  const batchSize = Math.max(1, options.batchSize ?? env.embeddingBatchSize);
  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  const eligible: Array<{ id: string; text: string }> = [];

  for (const event of candidates) {
    const text = buildEventEmbeddingText(event);
    if (text.length < minTextLength) {
      skipped += 1;
      continue;
    }

    eligible.push({ id: event.id, text });
  }

  for (const batch of chunk(eligible, batchSize)) {
    let vectors: number[][];
    try {
      vectors = await client.embedDocuments(batch.map((item) => item.text));
      if (vectors.length !== batch.length) {
        throw new Error(`Embedding response count mismatch: expected ${batch.length}, got ${vectors.length}`);
      }
    } catch {
      failed += batch.length;
      continue;
    }

    for (const [index, item] of batch.entries()) {
      try {
        const vector = vectors[index];
        if (!vector) {
          throw new Error(`Embedding response missing vector at index ${index}`);
        }
        await events.saveEventEmbedding(item.id, vector);
        embedded += 1;
      } catch {
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
