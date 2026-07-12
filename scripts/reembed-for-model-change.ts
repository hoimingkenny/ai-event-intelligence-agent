/**
 * Explicit operator path for model changes (ADR-0001).
 * Clears mismatched vectors and rewinds embeddable articles; does not run on boot.
 *
 *   npx tsx scripts/reembed-for-model-change.ts
 */
import { getDatabasePool } from '../src/db/pool.js';
import { currentEmbeddingProvenance } from '../src/config/embeddings.js';
import { createEmbeddingLifecycle } from '../src/embedding/lifecycle.js';

async function main(): Promise<void> {
  const pool = getDatabasePool();
  const lifecycle = createEmbeddingLifecycle(pool);
  const provenance = currentEmbeddingProvenance();
  const result = await lifecycle.reembedForModelChange();
  console.log(
    JSON.stringify(
      {
        currentModel: provenance.model,
        currentDims: provenance.dims,
        ...result,
      },
      null,
      2
    )
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
