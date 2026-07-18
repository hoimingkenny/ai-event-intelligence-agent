-- Article–CVE lifecycle: one row per (case, article). Holds raw mention evidence,
-- automated relevance, and the human verdict lifecycle state (ADR 0008, ticket #58).
--
-- lifecycle_state is promoted via a later human verdict (ticket #59); the automated
-- relevance task writes lifecycle_state='automated_relevant' but does not publish.
-- UNIQUE(case_id, article_id) keeps consolidation idempotent: re-runs upsert the
-- lifecycle_state and refresh first_evidence only when missing.

CREATE TABLE IF NOT EXISTS cve_case_articles (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cve_cases(id) ON DELETE CASCADE,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  lifecycle_state TEXT NOT NULL DEFAULT 'mentioned'
    CHECK (lifecycle_state IN ('mentioned', 'automated_relevant', 'human_confirmed', 'human_rejected', 'human_uncertain')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_evidence JSONB,
  automated_task_id BIGINT REFERENCES analysis_tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, article_id)
);
