export interface ArticleExtractionInput {
  url: string;
  rssSummary?: string | null;
}

export interface ArticleExtractionResult {
  cleanText: string | null;
  rawHtml?: string | null;
  method: 'rss_summary' | 'http' | 'playwright';
  status: 'rss_only' | 'http_success' | 'http_failed' | 'playwright_success' | 'playwright_failed';
  error?: string | null;
}

export interface ArticleExtractor {
  extract(input: ArticleExtractionInput): Promise<ArticleExtractionResult>;
}
