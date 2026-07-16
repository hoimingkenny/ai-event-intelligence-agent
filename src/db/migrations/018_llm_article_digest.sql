ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS llm_article_digest JSONB;
