-- Canonical grouping key on events (CVE-first, normalized vendor/product/attack
-- fallback). First rung of the event-grouping ladder: exact key match attaches
-- an article to an open event without any embedding or LLM work.
ALTER TABLE cyber_events ADD COLUMN IF NOT EXISTS grouping_key TEXT;

CREATE INDEX IF NOT EXISTS idx_cyber_events_grouping_key
  ON cyber_events (grouping_key)
  WHERE event_status = 'open';
