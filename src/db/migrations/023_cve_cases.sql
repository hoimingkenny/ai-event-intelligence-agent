-- CVE cases: one row per canonical CVE identifier (ADR 0008, ticket #58).

CREATE TABLE IF NOT EXISTS cve_cases (
  id BIGSERIAL PRIMARY KEY,
  cve_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_seen_article_id BIGINT REFERENCES articles(id) ON DELETE SET NULL,
  last_enriched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
