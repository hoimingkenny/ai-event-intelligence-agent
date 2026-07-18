-- Singleton per-source refresh cursor for CVE enrichment maintenance (ADR 0006, ticket #60).
--
-- One row per source. The pipeline-side initial enrichment never touches this table; the
-- maintenance scheduler (npm run cve:refresh) advances cursor_value and writes
-- last_tick_status='ok' on a successful tick, or 'failed'/'transient' on error so the next
-- tick can resume from the same cursor.

CREATE TABLE IF NOT EXISTS cve_refresh_state (
  source TEXT PRIMARY KEY CHECK (source IN ('nvd', 'kev', 'epss')),
  cursor_value TEXT,
  last_tick_started_at TIMESTAMPTZ,
  last_tick_completed_at TIMESTAMPTZ,
  last_tick_status TEXT CHECK (last_tick_status IN ('ok', 'failed', 'transient_failure', 'skipped')),
  last_tick_cases_observed INTEGER NOT NULL DEFAULT 0,
  last_tick_observations_appended INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);