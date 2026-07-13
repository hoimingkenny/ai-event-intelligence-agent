-- Publication status gates the public catalogue (ADR-0002).
-- Independent of incident lifecycle event_status (open/closed).
-- Existing rows backfill as draft so nothing is public until approved.
ALTER TABLE cyber_events
  ADD COLUMN IF NOT EXISTS publication_status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE cyber_events
  DROP CONSTRAINT IF EXISTS cyber_events_publication_status_check;

ALTER TABLE cyber_events
  ADD CONSTRAINT cyber_events_publication_status_check
  CHECK (publication_status IN ('draft', 'approved'));

CREATE INDEX IF NOT EXISTS idx_cyber_events_publication_status
  ON cyber_events (publication_status);
