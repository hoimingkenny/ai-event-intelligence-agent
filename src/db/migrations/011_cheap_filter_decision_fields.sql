ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS cheap_filter_decision TEXT,
  ADD COLUMN IF NOT EXISTS cheap_filter_score NUMERIC,
  ADD COLUMN IF NOT EXISTS cheap_filter_reasons TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cheap_filter_blocking_reasons TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cheap_filter_matched_signals JSONB NOT NULL DEFAULT '{}'::jsonb;
