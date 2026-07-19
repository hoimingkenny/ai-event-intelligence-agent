-- Indexes for review_events and approved-case lookups (ticket #59).

CREATE INDEX IF NOT EXISTS idx_review_events_case
  ON review_events (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_events_case_article
  ON review_events (case_article_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cve_cases_approved_at
  ON cve_cases (approved_at DESC NULLS LAST);
