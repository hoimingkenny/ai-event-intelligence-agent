-- CVE case approval columns and append-only review events (ADR 0008 / ticket #59).
--
-- cve_cases gains approved_at / approved_by_actor plus an optional reverted_at so the
-- auto-revert on final-confirmed-link removal is observable without losing the prior
-- approved_at. review_events is append-only: every human verdict, approval, and
-- auto-revert writes one row with actor + from_state + to_state + reason + payload.

ALTER TABLE cve_cases
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by_actor TEXT,
  ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reverted_by_actor TEXT;

CREATE TABLE IF NOT EXISTS review_events (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cve_cases(id) ON DELETE CASCADE,
  case_article_id BIGINT REFERENCES cve_case_articles(id) ON DELETE SET NULL,
  actor TEXT NOT NULL,
  event_kind TEXT NOT NULL
    CHECK (event_kind IN ('human_verdict', 'approval', 'auto_revert', 'unapproval')),
  from_state TEXT,
  to_state TEXT,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
