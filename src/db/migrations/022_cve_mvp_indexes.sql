-- Indexes for CVE MVP reads and analysis-task queue (ticket #57).

CREATE INDEX IF NOT EXISTS idx_cve_mentions_article
  ON cve_mentions (article_id);

CREATE INDEX IF NOT EXISTS idx_cve_mentions_cve
  ON cve_mentions (cve_id);

CREATE INDEX IF NOT EXISTS idx_analysis_tasks_target
  ON analysis_tasks (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_analysis_tasks_status_next_attempt
  ON analysis_tasks (status, next_attempt_at NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_analysis_tasks_task_name_status
  ON analysis_tasks (task_name, status);