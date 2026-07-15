-- Product-level active state and news volume so the pipeline can read the
-- monitored inventory from Postgres (replacing the JSON hot path).
ALTER TABLE vendor_products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE vendor_products
  ADD COLUMN IF NOT EXISTS news_volume TEXT NOT NULL DEFAULT 'quiet';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_products_news_volume_check'
  ) THEN
    ALTER TABLE vendor_products
      ADD CONSTRAINT vendor_products_news_volume_check
      CHECK (news_volume IN ('quiet', 'noisy'));
  END IF;
END $$;