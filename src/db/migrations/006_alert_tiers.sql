-- Two-tier alerting: early_warning (fast, labeled unconfirmed) vs confirmed.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS alert_tier TEXT;

-- Latest-alert lookups per event (suppression, upgrade decisions).
CREATE INDEX IF NOT EXISTS idx_alerts_event_created
  ON alerts (event_id, created_at DESC);
