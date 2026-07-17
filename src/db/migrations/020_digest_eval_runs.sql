-- Offline digest eval runs and per-article predictions (ADR 0005).

CREATE TABLE IF NOT EXISTS digest_eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  mode TEXT NOT NULL CHECK (mode IN ('baseline', 'regen')),
  prompt_version TEXT NOT NULL,
  model_name TEXT,

  gold_count INTEGER NOT NULL DEFAULT 0,
  cli_args JSONB NOT NULL DEFAULT '{}'::jsonb,

  comparison_baseline_run_id UUID REFERENCES digest_eval_runs(id) ON DELETE SET NULL,

  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,

  total_predictions_saved INTEGER NOT NULL DEFAULT 0,
  total_predictions_failed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_digest_eval_runs_started
  ON digest_eval_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_digest_eval_runs_mode_prompt
  ON digest_eval_runs (mode, prompt_version, started_at DESC);

CREATE TABLE IF NOT EXISTS digest_eval_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  run_id UUID NOT NULL REFERENCES digest_eval_runs(id) ON DELETE CASCADE,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,

  prediction_json JSONB,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_digest_eval_run_article UNIQUE (run_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_digest_eval_predictions_run
  ON digest_eval_predictions (run_id);

CREATE INDEX IF NOT EXISTS idx_digest_eval_predictions_article
  ON digest_eval_predictions (article_id);
