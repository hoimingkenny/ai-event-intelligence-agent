-- CVE MVP: deterministic CVE mentions and durable analysis-task queue (ADR 0008 / ticket #57).

-- One row per (article, canonical CVE id, zone). A CVE mentioned in multiple zones
-- produces one row per zone so each evidence snippet is independently inspectable.
CREATE TABLE IF NOT EXISTS cve_mentions (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  cve_id TEXT NOT NULL,
  zone TEXT NOT NULL CHECK (zone IN ('title', 'rss_summary', 'clean_text', 'source_link')),
  snippet TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generic durable analysis-task queue. Independent from articles.processing_status so
-- summary, disposition, and per-CVE relevance can run and retry without overloading
-- the article's coarse ingest/extraction lifecycle.
CREATE TABLE IF NOT EXISTS analysis_tasks (
  id BIGSERIAL PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id BIGINT NOT NULL,
  task_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'needs_attention')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  prompt_version TEXT,
  model TEXT,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, task_name)
);