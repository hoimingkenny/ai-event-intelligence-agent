import { EventRepository } from '../db/repositories/event.repository.js';
import type { Queryable } from '../db/repositories/types.js';
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
  options: { limit?: number; client?: EmbeddingClient; minTextLength?: number } = {}
): Promise<EventEmbeddingStageResult> {
  const events = new EventRepository(db);
  const candidates = await events.listEventsMissingEmbedding(options.limit ?? 20);
  const client = options.client ?? new MiniMaxEmbeddingClient();
  const minTextLength = options.minTextLength ?? 20;
  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of candidates) {
    const text = buildEventEmbeddingText(event);
    if (text.length < minTextLength) {
      skipped += 1;
      continue;
    }

    try {
      const vector = await client.embedDocument(text);
      await events.saveEventEmbedding(event.id, vector);
      embedded += 1;
    } catch {
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
