-- Human review verdicts become append-only history: re-reviews insert new
-- rows instead of overwriting, so verdict changes over time are measurable.
-- Reads take the latest row per article (DISTINCT ON ... reviewed_at DESC).
ALTER TABLE human_review_verdicts
  DROP CONSTRAINT IF EXISTS human_review_verdicts_article_id_key;

CREATE INDEX IF NOT EXISTS idx_human_review_verdicts_article_latest
  ON human_review_verdicts (article_id, reviewed_at DESC, id DESC);
