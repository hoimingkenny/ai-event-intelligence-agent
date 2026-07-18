-- Indexes for CVE case reads, lifecycle joins, and source observation windows
-- (tickets #58 and #60).

CREATE INDEX IF NOT EXISTS idx_cve_cases_status
  ON cve_cases (status);

CREATE INDEX IF NOT EXISTS idx_cve_cases_cve_id
  ON cve_cases (cve_id);

CREATE INDEX IF NOT EXISTS idx_cve_case_articles_case
  ON cve_case_articles (case_id);

CREATE INDEX IF NOT EXISTS idx_cve_case_articles_article
  ON cve_case_articles (article_id);

CREATE INDEX IF NOT EXISTS idx_cve_case_articles_state
  ON cve_case_articles (lifecycle_state);

CREATE INDEX IF NOT EXISTS idx_cve_source_observations_case_source_time
  ON cve_source_observations (case_id, source, retrieved_at DESC);
