ALTER TABLE cyber_events
  ADD COLUMN IF NOT EXISTS summary_stale BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cyber_events_needing_summary
  ON cyber_events (last_seen_at DESC, id DESC)
  WHERE llm_summary IS NULL OR summary_stale;
