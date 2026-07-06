-- OpenRouter nvidia/llama-nemotron-embed-vl-1b-v2 returns 2048-dimensional
-- vectors. Existing 1536-dimensional embeddings cannot be cast to 2048, so
-- clear them and let the embedding stages regenerate vectors.
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
  ALTER COLUMN embedding TYPE vector(2048);

ALTER TABLE cyber_events
  ALTER COLUMN event_embedding TYPE vector(2048);

-- Do not recreate HNSW indexes for 2048-dimensional vectors: pgvector rejects
-- HNSW indexes above 2000 dimensions. Similarity queries still work through
-- sequential scans; if volume requires indexing, use a <=2000-dim embedding
-- model or add an expression index with an explicit lower-dimensional cast.
