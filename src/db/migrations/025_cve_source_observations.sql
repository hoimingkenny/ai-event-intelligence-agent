-- Source-polymorphic enrichment observations (ADR 0008, ticket #58).
-- One row per observation; idempotent re-runs append a new observation only when the
-- normalized value actually changes. Failed/transient observations are auditable but
-- never replace the latest successful terminal observation (ticket #60 semantics).
--
-- Terminal status values: 'ok', 'not_found', 'no_score' (these are the "current" outcomes
-- the Workspace surfaces). 'failed' and 'transient_failure' never overwrite a terminal row.

CREATE TABLE IF NOT EXISTS cve_source_observations (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cve_cases(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('nvd', 'kev', 'epss')),
  status TEXT NOT NULL CHECK (status IN ('ok', 'not_found', 'no_score', 'failed', 'transient_failure')),
  normalized_value JSONB,
  provenance TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_kind TEXT NOT NULL DEFAULT 'initial'
    CHECK (attempt_kind IN ('initial', 'maintenance_nvd', 'maintenance_kev', 'maintenance_epss')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
