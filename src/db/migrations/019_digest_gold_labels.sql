-- Human digest gold labels for LLM article-digest eval (ADR 0005).

CREATE TABLE IF NOT EXISTS digest_gold_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  article_id BIGINT NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,

  related_to_monitored_inventory BOOLEAN NOT NULL,
  matched_vendors TEXT[] NOT NULL DEFAULT '{}',
  matched_products TEXT[] NOT NULL DEFAULT '{}',
  cves TEXT[] NOT NULL DEFAULT '{}',
  human_reason TEXT,

  article_snapshot JSONB NOT NULL,
  inventory_snapshot JSONB NOT NULL,

  labeled_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_digest_gold_labels_updated
  ON digest_gold_labels (updated_at DESC);
