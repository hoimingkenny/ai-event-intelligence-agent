-- Offline LLM evaluation layer for the deterministic cheap filter.
-- Production filter remains deterministic; this layer only stores judgments
-- used to tune the rule engine.

CREATE TABLE IF NOT EXISTS cheap_filter_llm_eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  sample_size INTEGER NOT NULL,
  since_days INTEGER NOT NULL,
  source_tier_filter TEXT,
  decision_filter TEXT,

  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,

  cli_args JSONB NOT NULL DEFAULT '{}'::jsonb,

  concurrency INTEGER NOT NULL DEFAULT 1,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,

  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,

  article_ids BIGINT[] NOT NULL DEFAULT '{}',

  total_articles_sampled INTEGER NOT NULL DEFAULT 0,
  total_evaluations_saved INTEGER NOT NULL DEFAULT 0,
  total_evaluations_failed INTEGER NOT NULL DEFAULT 0,

  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_cheap_filter_llm_eval_runs_started
  ON cheap_filter_llm_eval_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_cheap_filter_llm_eval_runs_prompt_model
  ON cheap_filter_llm_eval_runs (model_name, prompt_version, started_at DESC);

CREATE TABLE IF NOT EXISTS cheap_filter_llm_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  run_id UUID NOT NULL REFERENCES cheap_filter_llm_eval_runs(id) ON DELETE CASCADE,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,

  -- Snapshot of cheap-filter state at sample time (immutable, even if the
  -- filter is later re-run on the same article).
  cheap_filter_decision TEXT NOT NULL,
  cheap_filter_score NUMERIC NOT NULL,
  cheap_filter_matched_signals JSONB NOT NULL,
  cheap_filter_blocking_reasons TEXT[] NOT NULL DEFAULT '{}',

  -- LLM judgment.
  llm_label TEXT NOT NULL,
  expected_decision TEXT NOT NULL,
  score_assessment TEXT NOT NULL,
  recommended_score_band TEXT,
  is_actionable_for_impact_review BOOLEAN NOT NULL,
  relevance_type TEXT NOT NULL,
  scoring_issue TEXT NOT NULL,

  explanation TEXT NOT NULL,
  suggested_rule_changes TEXT[] NOT NULL DEFAULT '{}',
  suggested_keywords_to_add TEXT[] NOT NULL DEFAULT '{}',
  suggested_vendor_product_aliases_to_add TEXT[] NOT NULL DEFAULT '{}',

  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,

  raw_llm_response JSONB NOT NULL,
  parse_retries INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One evaluation per (run, article). A second run may re-evaluate the
  -- same article with a different model or prompt version.
  CONSTRAINT uq_cheap_filter_llm_eval_run_article UNIQUE (run_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_cheap_filter_llm_eval_article
  ON cheap_filter_llm_evaluations (article_id);

CREATE INDEX IF NOT EXISTS idx_cheap_filter_llm_eval_run
  ON cheap_filter_llm_evaluations (run_id);

CREATE INDEX IF NOT EXISTS idx_cheap_filter_llm_eval_label
  ON cheap_filter_llm_evaluations (llm_label);

CREATE INDEX IF NOT EXISTS idx_cheap_filter_llm_eval_scoring_issue
  ON cheap_filter_llm_evaluations (scoring_issue);

CREATE INDEX IF NOT EXISTS idx_cheap_filter_llm_eval_score_assessment
  ON cheap_filter_llm_evaluations (score_assessment);

CREATE INDEX IF NOT EXISTS idx_cheap_filter_llm_eval_disagreement
  ON cheap_filter_llm_evaluations (cheap_filter_decision, expected_decision);