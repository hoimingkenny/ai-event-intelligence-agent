import { ArticleRepository, type ArticleRecord } from '../db/repositories/article.repository.js';
import { detectCategorizedCyberKeywords } from '../detection/cyber-keyword-classifier.js';
import { extractCves } from '../detection/cve-extractor.js';
import { detectVendorsFromInventory } from '../detection/vendor-detector.js';
import { monitoredVendors } from '../storage/vendorInventory.js';
import type { Queryable } from '../db/repositories/types.js';

export type CheapFilterDecision = 'KEEP' | 'MAYBE_KEEP' | 'DROP';
export type SourceTier =
  | 'official_vendor'
  | 'government_cert'
  | 'security_media'
  | 'researcher_blog'
  | 'general_news'
  | 'unknown';

export interface CheapFilterMatchedSignals {
  criticalCyberKeywords: string[];
  mediumCyberKeywords: string[];
  lowCyberKeywords: string[];
  negativeKeywords: string[];
  cves: string[];
  vendors: string[];
  products: string[];
  rssCategories: string[];
  sourceTier: SourceTier;
}

export interface FilterDecision {
  decision: CheapFilterDecision;
  score: number;
  reasons: string[];
  blockingReasons: string[];
  matchedSignals: CheapFilterMatchedSignals;
  shouldExtract: boolean;
  cves: string[];
  vendors: string[];
  products: string[];
}

export interface FilterStageResult {
  reviewed: number;
  extractionPending: number;
  extractionPendingLowPriority: number;
  ignored: number;
}

type CheapFilterInput = Pick<ArticleRecord, 'title' | 'rssSummary'> &
  Partial<Pick<ArticleRecord, 'sourceName' | 'publishedAt'>> & {
    rssCategories?: string[];
    sourceTier?: SourceTier;
  };

const SECURITY_RSS_CATEGORIES = [
  'security',
  'cybersecurity',
  'vulnerability',
  'vulnerabilities',
  'malware',
  'ransomware',
  'zero day',
  'zero-day',
  'data breach',
  'threat intelligence',
  'security advisory',
  'patch',
  'incident',
];

const NOISY_VENDOR_NAMES = new Set(['microsoft', 'cloudflare', 'google', 'amazon', 'oracle', 'cisco', 'ibm']);

export function decideCheapFilter(article: CheapFilterInput): FilterDecision {
  const text = [article.title, article.rssSummary, ...(article.rssCategories ?? [])]
    .filter(Boolean)
    .join('\n');
  const keywords = detectCategorizedCyberKeywords(text);
  const cves = extractCves(text);
  const vendors = detectVendorsFromInventory(text, monitoredVendors);
  const sourceTier = article.sourceTier ?? inferSourceTier(article.sourceName);
  const securityCategories = securityRssCategories(article.rssCategories ?? []);
  const reasons = new Set<string>();
  const blockingReasons = new Set<string>();
  let score = 0;

  if (cves.length > 0) addScore('cve_found', 50);
  if (vendors.products.length > 0) addScore('monitored_product_found', 45);
  if (vendors.vendors.length > 0) addScore('monitored_vendor_found', 35);
  if (keywords.critical.length > 0) addScore('critical_cyber_keyword_found', 35);
  if (keywords.medium.length > 0) addScore('medium_cyber_keyword_found', 20);
  if (keywords.low.length > 0) addScore('low_cyber_keyword_found', 5);
  if (sourceTier === 'official_vendor') addScore('official_vendor_source', 25);
  if (sourceTier === 'government_cert') addScore('government_cert_source', 25);
  if (sourceTier === 'security_media') addScore('security_media_source', 10);
  if (sourceTier === 'researcher_blog') addScore('researcher_blog_source', 10);
  if (securityCategories.length > 0) addScore('security_rss_category_found', 10);
  if (isRecent(article.publishedAt)) addScore('recent_article', 10);

  if (keywords.negative.length > 0) {
    score -= 20;
    blockingReasons.add('cheap_filter_negative_business_context');
  }

  const hasCyberContext =
    cves.length > 0 ||
    keywords.critical.length > 0 ||
    keywords.medium.length > 0 ||
    securityCategories.length > 0 ||
    sourceTier === 'official_vendor' ||
    sourceTier === 'government_cert' ||
    sourceTier === 'security_media';
  const hasStrongPositiveSignal =
    cves.length > 0 ||
    keywords.critical.length > 0 ||
    vendors.products.length > 0 ||
    sourceTier === 'official_vendor' ||
    sourceTier === 'government_cert';

  if (vendors.products.length > 0 && hasCyberContext) reasons.add('product_with_cyber_context');
  if (vendors.vendors.length > 0 && hasCyberContext) reasons.add('vendor_with_cyber_context');
  if (
    (sourceTier === 'official_vendor' || sourceTier === 'government_cert' || sourceTier === 'security_media') &&
    (keywords.critical.length > 0 || keywords.medium.length > 0 || securityCategories.length > 0)
  ) {
    reasons.add('trusted_source_with_security_context');
  }

  if (cves.length === 0) blockingReasons.add('cheap_filter_no_cve_in_rss_metadata');
  if (vendors.vendors.length === 0 && vendors.products.length === 0) {
    blockingReasons.add('cheap_filter_no_vendor_product_in_rss_metadata');
  }
  if (keywords.critical.length === 0 && keywords.medium.length === 0 && keywords.low.length === 0) {
    blockingReasons.add('cheap_filter_no_cyber_keyword_in_rss_metadata');
  }
  if (sourceTier === 'general_news') blockingReasons.add('cheap_filter_general_news_source');

  if (isVendorOnlyWithoutSecurityContext(vendors.vendors, vendors.products, hasCyberContext)) {
    blockingReasons.add('cheap_filter_vendor_only_without_security_context');
    if (vendors.vendors.some((vendor) => NOISY_VENDOR_NAMES.has(vendor.toLowerCase()))) {
      score -= 20;
    }
  }

  if (isOld(article.publishedAt)) {
    score -= 20;
    blockingReasons.add('cheap_filter_old_or_stale_article');
  }

  let decision: CheapFilterDecision;
  if (cves.length > 0 || keywords.critical.length > 0 || (vendors.products.length > 0 && hasCyberContext)) {
    decision = 'KEEP';
  } else if (
    sourceTier === 'official_vendor' ||
    sourceTier === 'government_cert' ||
    (vendors.vendors.length > 0 && keywords.medium.length > 0) ||
    (score >= 40 && hasStrongPositiveSignal)
  ) {
    decision = hasNegativeDominance(hasStrongPositiveSignal, keywords.negative) ? 'MAYBE_KEEP' : 'KEEP';
  } else if (score >= 15 || hasLowCombination(keywords.low)) {
    decision = 'MAYBE_KEEP';
  } else {
    decision = 'DROP';
  }

  if (decision === 'DROP') {
    blockingReasons.add('cheap_filter_insufficient_rss_signal');
    if (score < 15) blockingReasons.add('cheap_filter_low_score');
  }

  const matchedSignals: CheapFilterMatchedSignals = {
    criticalCyberKeywords: keywords.critical,
    mediumCyberKeywords: keywords.medium,
    lowCyberKeywords: keywords.low,
    negativeKeywords: keywords.negative,
    cves,
    vendors: vendors.vendors,
    products: vendors.products,
    rssCategories: securityCategories,
    sourceTier,
  };

  function addScore(reason: string, value: number): void {
    reasons.add(reason);
    score += value;
  }

  const reasonList = Array.from(reasons);
  const blockingReasonList = Array.from(blockingReasons);
  if (reasonList.length === 0 && blockingReasonList.length === 0) {
    blockingReasonList.push('cheap_filter_insufficient_rss_signal');
  }

  return {
    decision,
    score,
    reasons: reasonList,
    blockingReasons: blockingReasonList,
    matchedSignals,
    shouldExtract: decision !== 'DROP',
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
  let extractionPendingLowPriority = 0;
  let ignored = 0;

  for (const article of candidates) {
    const decision = decideCheapFilter(article);
    await articles.saveCheapFilterResult(article.id, decision);

    if (decision.decision === 'KEEP') {
      await articles.updateProcessingStatus(article.id, 'EXTRACTION_PENDING');
      extractionPending += 1;
    } else if (decision.decision === 'MAYBE_KEEP') {
      await articles.updateProcessingStatus(article.id, 'EXTRACTION_PENDING_LOW_PRIORITY');
      extractionPendingLowPriority += 1;
    } else {
      await articles.updateProcessingStatus(article.id, 'IGNORED', decision.blockingReasons.join(','));
      ignored += 1;
    }
  }

  return {
    reviewed: candidates.length,
    extractionPending,
    extractionPendingLowPriority,
    ignored,
  };
}

export function inferSourceTier(sourceName?: string | null): SourceTier {
  const source = sourceName?.toLowerCase() ?? '';
  if (source.includes('cisa') || source.includes('cert')) return 'government_cert';
  if (source.includes('psirt') || source.includes('msrc') || source.includes('security advisories')) {
    return 'official_vendor';
  }
  if (
    source.includes('bleeping') ||
    source.includes('hacker news') ||
    source.includes('krebs') ||
    source.includes('securityweek') ||
    source.includes('dark reading')
  ) {
    return 'security_media';
  }
  if (source.includes('blog') || source.includes('research')) return 'researcher_blog';
  if (source.includes('business') || source.includes('news')) return 'general_news';
  return 'unknown';
}

function securityRssCategories(categories: string[]): string[] {
  return categories.filter((category) => {
    const normalized = category.toLowerCase();
    return SECURITY_RSS_CATEGORIES.some((securityCategory) => normalized.includes(securityCategory));
  });
}

function isRecent(publishedAt?: Date | null): boolean {
  if (!publishedAt) return false;
  return Date.now() - publishedAt.getTime() <= 24 * 60 * 60 * 1000;
}

function isOld(publishedAt?: Date | null): boolean {
  if (!publishedAt) return false;
  return Date.now() - publishedAt.getTime() > 14 * 24 * 60 * 60 * 1000;
}

function isVendorOnlyWithoutSecurityContext(
  matchedVendors: string[],
  matchedProducts: string[],
  hasCyberContext: boolean
): boolean {
  return matchedVendors.length > 0 && matchedProducts.length === 0 && !hasCyberContext;
}

function hasNegativeDominance(hasStrongPositiveSignal: boolean, negativeKeywords: string[]): boolean {
  return negativeKeywords.length > 0 && !hasStrongPositiveSignal;
}

function hasLowCombination(lowKeywords: string[]): boolean {
  const low = new Set(lowKeywords.map((keyword) => keyword.toLowerCase()));
  return (
    (low.has('identity') && low.has('attack')) ||
    (low.has('cloud') && low.has('vulnerability')) ||
    (low.has('authentication') && low.has('bypass')) ||
    (low.has('admin') && low.has('compromise')) ||
    (low.has('api') && low.has('exposure')) ||
    (low.has('account') && low.has('takeover')) ||
    (low.has('password') && low.has('leak')) ||
    (low.has('login') && low.has('bypass'))
  );
}
