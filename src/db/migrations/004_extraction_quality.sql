-- Extraction quality ground truth: word recall of rss_summary against
-- clean_text, computed at extraction time. Drives per-source drift detection.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS rss_recall NUMERIC;

CREATE INDEX IF NOT EXISTS idx_articles_source_extracted_at
  ON articles (source_name, extracted_at DESC)
  WHERE extracted_at IS NOT NULL;
