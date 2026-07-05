ALTER TABLE human_review_verdicts
  ADD COLUMN IF NOT EXISTS llm_classification_verdict TEXT NOT NULL DEFAULT 'not_reviewed'
    CHECK (llm_classification_verdict IN ('not_reviewed', 'correct', 'incorrect', 'unclear'));
