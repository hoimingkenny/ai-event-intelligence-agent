CREATE TABLE IF NOT EXISTS llm_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id BIGINT NOT NULL,
  task_name TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT NOT NULL,
  request_json JSONB,
  response_json JSONB,
  validation_status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_audit_logs_target
  ON llm_audit_logs (target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_audit_logs_task
  ON llm_audit_logs (task_name, created_at DESC);
