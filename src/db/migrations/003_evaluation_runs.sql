CREATE TABLE IF NOT EXISTS evaluation_runs (
  id BIGSERIAL PRIMARY KEY,
  run_name TEXT NOT NULL,
  dataset_name TEXT NOT NULL,
  duplicate_reduction_rate NUMERIC,
  event_grouping_precision NUMERIC,
  classification_precision NUMERIC,
  false_positive_rate NUMERIC,
  llm_call_reduction_rate NUMERIC,
  extraction_success_rate NUMERIC,
  median_source_to_notification_latency_seconds NUMERIC,
  metrics_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_runs_created_at
  ON evaluation_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evaluation_runs_dataset
  ON evaluation_runs (dataset_name, created_at DESC);
