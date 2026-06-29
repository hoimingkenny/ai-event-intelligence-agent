import { ArticleRepository, type ArticleRecord } from '../db/repositories/article.repository.js';
import { detectCyberKeywords } from '../detection/cyber-keyword-detector.js';
import { extractCves } from '../detection/cve-extractor.js';
import { detectVendorsFromInventory } from '../detection/vendor-detector.js';
import { monitoredVendors } from '../storage/vendorInventory.js';
import type { Queryable } from '../db/repositories/types.js';

export interface FilterDecision {
  shouldExtract: boolean;
  reasons: string[];
  cves: string[];
  vendors: string[];
  products: string[];
}

export interface FilterStageResult {
  reviewed: number;
  extractionPending: number;
  ignored: number;
}

export function decideCheapFilter(article: Pick<ArticleRecord, 'title' | 'rssSummary'>): FilterDecision {
  const text = [article.title, article.rssSummary].filter(Boolean).join('\n');
  const keywords = detectCyberKeywords(text);
  const cves = extractCves(text);
  const vendors = detectVendorsFromInventory(text, monitoredVendors);
  const reasons = [
    ...keywords.matchedKeywords.map((keyword) => `keyword:${keyword}`),
    ...cves.map((cve) => `cve:${cve}`),
    ...vendors.matchedAliases.map((alias) => `vendor_or_product:${alias}`),
  ];

  return {
    shouldExtract: keywords.isCyberRelevant || cves.length > 0 || vendors.matchedAliases.length > 0,
    reasons,
    cves,
    vendors: vendors.vendors,
    products: vendors.products,
  };
}

export async function runCheapFilterStage(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<FilterStageResult> {
  const articles = new ArticleRepository(db);
  const candidates = await articles.listByProcessingStatus('NEW', options.limit ?? 50);
  let extractionPending = 0;
  let ignored = 0;

  for (const article of candidates) {
    const decision = decideCheapFilter(article);
    if (decision.shouldExtract) {
      await articles.updateProcessingStatus(article.id, 'EXTRACTION_PENDING');
      extractionPending += 1;
    } else {
      await articles.updateProcessingStatus(article.id, 'IGNORED', 'cheap_filter_no_signal');
      ignored += 1;
    }
  }

  return {
    reviewed: candidates.length,
    extractionPending,
    ignored,
  };
}
