CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS vendors (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  criticality TEXT NOT NULL DEFAULT 'medium',
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendor_aliases (
  id BIGSERIAL PRIMARY KEY,
  vendor_id BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, alias)
);

CREATE TABLE IF NOT EXISTS vendor_products (
  id BIGSERIAL PRIMARY KEY,
  vendor_id BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  criticality TEXT NOT NULL DEFAULT 'medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, product_name)
);

CREATE TABLE IF NOT EXISTS vendor_product_aliases (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES vendor_products(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, alias)
);

CREATE TABLE IF NOT EXISTS feeds (
  id BIGSERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  feed_url TEXT NOT NULL UNIQUE,
  source_type TEXT,
  trust_level TEXT NOT NULL DEFAULT 'medium',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS articles (
  id BIGSERIAL PRIMARY KEY,
  feed_id BIGINT REFERENCES feeds(id),
  source_name TEXT,
  title TEXT,
  canonical_url TEXT UNIQUE,
  final_url TEXT,
  url_hash TEXT,
  title_hash TEXT,
  content_hash TEXT,
  rss_summary TEXT,
  raw_html TEXT,
  clean_text TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  extraction_method TEXT,
  extraction_error TEXT,
  extracted_at TIMESTAMPTZ,
  processing_status TEXT NOT NULL DEFAULT 'NEW',
  processing_error TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_processed_at TIMESTAMPTZ,
  content_quality_score NUMERIC,
  embedding vector(1536),
  llm_classification JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS article_entities (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_value TEXT NOT NULL,
  confidence NUMERIC,
  role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, entity_type, entity_value, role)
);

CREATE TABLE IF NOT EXISTS cyber_events (
  id BIGSERIAL PRIMARY KEY,
  event_title TEXT,
  event_summary TEXT,
  event_status TEXT NOT NULL DEFAULT 'open',
  severity TEXT,
  urgency TEXT,
  confidence NUMERIC,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  affected_vendors TEXT[] NOT NULL DEFAULT '{}',
  affected_products TEXT[] NOT NULL DEFAULT '{}',
  cves TEXT[] NOT NULL DEFAULT '{}',
  attack_types TEXT[] NOT NULL DEFAULT '{}',
  source_count INT NOT NULL DEFAULT 0,
  event_embedding vector(1536),
  llm_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_articles (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES cyber_events(id) ON DELETE CASCADE,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  relationship TEXT,
  confidence NUMERIC,
  is_primary_source BOOLEAN NOT NULL DEFAULT false,
  is_material_update BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, article_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES cyber_events(id) ON DELETE CASCADE,
  alert_status TEXT,
  alert_channel TEXT,
  alert_reason TEXT,
  severity TEXT,
  urgency TEXT,
  suppressed BOOLEAN NOT NULL DEFAULT false,
  suppression_reason TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_articles_published_at
  ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_canonical_url
  ON articles (canonical_url);
CREATE INDEX IF NOT EXISTS idx_articles_url_hash
  ON articles (url_hash);
CREATE INDEX IF NOT EXISTS idx_articles_content_hash
  ON articles (content_hash);
CREATE INDEX IF NOT EXISTS idx_articles_title_hash
  ON articles (title_hash);
CREATE INDEX IF NOT EXISTS idx_articles_processing_status
  ON articles (processing_status);
CREATE INDEX IF NOT EXISTS idx_articles_extraction_status
  ON articles (extraction_status);
CREATE INDEX IF NOT EXISTS idx_article_entities_value
  ON article_entities (entity_value);
CREATE INDEX IF NOT EXISTS idx_article_entities_type_value
  ON article_entities (entity_type, entity_value);
CREATE INDEX IF NOT EXISTS idx_cyber_events_last_seen
  ON cyber_events (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_cyber_events_severity
  ON cyber_events (severity);
CREATE INDEX IF NOT EXISTS idx_cyber_events_urgency
  ON cyber_events (urgency);
CREATE INDEX IF NOT EXISTS idx_cyber_events_affected_vendors
  ON cyber_events USING GIN (affected_vendors);
CREATE INDEX IF NOT EXISTS idx_articles_embedding
  ON articles USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_cyber_events_embedding
  ON cyber_events USING hnsw (event_embedding vector_cosine_ops);
