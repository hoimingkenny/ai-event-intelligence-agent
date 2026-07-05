CREATE TABLE IF NOT EXISTS human_review_verdicts (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  event_id BIGINT REFERENCES cyber_events(id) ON DELETE SET NULL,
  relevance_verdict TEXT NOT NULL DEFAULT 'not_reviewed'
    CHECK (relevance_verdict IN ('not_reviewed', 'correct', 'incorrect', 'unclear')),
  vendor_impact_verdict TEXT NOT NULL DEFAULT 'not_reviewed'
    CHECK (vendor_impact_verdict IN ('not_reviewed', 'correct', 'incorrect', 'unclear')),
  grouping_verdict TEXT NOT NULL DEFAULT 'not_reviewed'
    CHECK (grouping_verdict IN ('not_reviewed', 'correct', 'incorrect', 'unclear')),
  alert_verdict TEXT NOT NULL DEFAULT 'not_reviewed'
    CHECK (alert_verdict IN ('not_reviewed', 'correct', 'incorrect', 'unclear')),
  notes TEXT,
  reviewer TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id)
);

CREATE INDEX IF NOT EXISTS idx_human_review_verdicts_reviewed_at
  ON human_review_verdicts (reviewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_human_review_verdicts_event
  ON human_review_verdicts (event_id);
