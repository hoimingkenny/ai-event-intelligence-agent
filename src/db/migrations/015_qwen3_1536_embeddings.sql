-- Switch embeddings to qwen/qwen3-embedding-8b truncated to 1536 dimensions
-- (Matryoshka truncate-then-renormalize in src/config/embeddings.ts).
-- Vectors from the previous model (nvidia/llama-nemotron-embed-vl-1b-v2,
-- 2048-dim) live in a different vector space and cannot be compared with the
-- new model's output, so clear them and let the embedding stages regenerate.
-- 1536 is back under pgvector's 2000-dimension HNSW limit, so the ANN indexes
-- dropped by migration 010 are restored.
DROP INDEX IF EXISTS idx_articles_embedding;
DROP INDEX IF EXISTS idx_cyber_events_embedding;

UPDATE articles
SET embedding = NULL,
  processing_status = CASE
    WHEN processing_status = 'EMBEDDED' THEN 'ENTITY_EXTRACTED'
    ELSE processing_status
  END,
  updated_at = now()
WHERE embedding IS NOT NULL;

UPDATE cyber_events
SET event_embedding = NULL,
  updated_at = now()
WHERE event_embedding IS NOT NULL;

ALTER TABLE articles
  ALTER COLUMN embedding TYPE vector(1536);

ALTER TABLE cyber_events
  ALTER COLUMN event_embedding TYPE vector(1536);

CREATE INDEX IF NOT EXISTS idx_articles_embedding
  ON articles USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_cyber_events_embedding
  ON cyber_events USING hnsw (event_embedding vector_cosine_ops);
