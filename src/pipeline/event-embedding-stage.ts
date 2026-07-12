import type { Queryable } from '../db/repositories/types.js';
import { createEmbeddingLifecycle } from '../embedding/lifecycle.js';

export interface EventEmbeddingStageResult {
  reviewed: number;
  embedded: number;
  skipped: number;
  failed: number;
}

/**
 * Deferred sweep: copy a member article embedding onto events still missing a
 * vector (create-path failures, historical gaps). No template re-embed.
 */
export async function runEventEmbeddingStage(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<EventEmbeddingStageResult> {
  const lifecycle = createEmbeddingLifecycle(db);
  return lifecycle.sweepMissingEventEmbeddings({
    limit: options.limit ?? 20,
  });
}
