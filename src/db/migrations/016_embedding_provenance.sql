-- Vector provenance for article and event embeddings (ADR-0001).
-- Existing vectors keep NULL model/dims/embedded_at and are ineligible for
-- similarity until explicitly re-embedded.
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedding_dims INT,
  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

ALTER TABLE cyber_events
  ADD COLUMN IF NOT EXISTS event_embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS event_embedding_dims INT,
  ADD COLUMN IF NOT EXISTS event_embedded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS event_embedding_retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS event_embedding_error TEXT;
