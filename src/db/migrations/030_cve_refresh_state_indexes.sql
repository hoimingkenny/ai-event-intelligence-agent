-- No additional indexes are needed for cve_refresh_state (PRIMARY KEY on source is sufficient
-- and the only query patterns are point reads by source and a full table read for diagnostics).
-- This migration exists to keep numeric ordering aligned with future refresh-related additions.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_cve_refresh_state_updated_at') THEN
    CREATE INDEX idx_cve_refresh_state_updated_at ON cve_refresh_state (updated_at DESC NULLS LAST);
  END IF;
END $$;