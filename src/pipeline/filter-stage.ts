import { ArticleRepository, type ArticleRecord } from '../db/repositories/article.repository.js';
import { detectCategorizedCyberKeywords } from '../detection/cyber-keyword-classifier.js';
import { extractCves } from '../detection/cve-extractor.js';
import { detectVendorsFromInventory } from '../detection/vendor-detector.js';
import { loadMonitoredInventoryFromDb } from '../storage/monitoredInventoryStore.js';
import type { Queryable } from '../db/repositories/types.js';
import type { VendorProduct } from '../types/domain.js';

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

interface CheapFilterSignals {
  text: string;
  keywords: ReturnType<typeof detectCategorizedCyberKeywords>;
  cves: string[];
  vendors: ReturnType<typeof detectVendorsFromInventory>;
  sourceTier: SourceTier;
  securityCategories: string[];
  matchedInventory: VendorProduct[];
}

export function decideCheapFilter(article: CheapFilterInput, inventory: VendorProduct[]): FilterDecision {
  const signals = collectCheapFilterSignals(article, inventory);
  return runCheapFilterCascade(article, signals);
}

function collectCheapFilterSignals(article: CheapFilterInput, inventory: VendorProduct[]): CheapFilterSignals {
  const text = [article.title, article.rssSummary, ...(article.rssCategories ?? [])]
    .filter(Boolean)
    .join('\n');
  const keywords = detectCategorizedCyberKeywords(text);
  const cves = extractCves(text);
  const vendors = detectVendorsFromInventory(text, inventory);
  const sourceTier = article.sourceTier ?? inferSourceTier(article.sourceName);
  const securityCategories = securityRssCategories(article.rssCategories ?? []);
  return {
    text,
    keywords,
    cves,
    vendors,
    sourceTier,
    securityCategories,
    matchedInventory: findMatchedInventory(vendors.vendors, vendors.products, inventory),
  };
}

function runCheapFilterCascade(article: CheapFilterInput, signals: CheapFilterSignals): FilterDecision {
  const { keywords, cves, vendors, sourceTier, securityCategories } = signals;
  const reasons = new Set<string>();
  const blockingReasons = new Set<string>();
  addSignalReasons(article, signals, reasons, blockingReasons);

  if (cves.length === 0) blockingReasons.add('cheap_filter_no_cve_in_rss_metadata');
  if (vendors.vendors.length === 0 && vendors.products.length === 0) {
    blockingReasons.add('cheap_filter_no_vendor_product_in_rss_metadata');
  }
  if (keywords.critical.length === 0 && keywords.medium.length === 0 && keywords.low.length === 0) {
    blockingReasons.add('cheap_filter_no_cyber_keyword_in_rss_metadata');
  }
  if (sourceTier === 'general_news') blockingReasons.add('cheap_filter_general_news_source');

  if (isOld(article.publishedAt)) {
    blockingReasons.add('cheap_filter_old_or_stale_article');
  }

  const hasVendorMatch = vendors.vendors.length > 0 || vendors.products.length > 0;
  const hasEscapeHatchSignal = cves.length > 0 || keywords.criticalExploitation.length > 0 || isTrustedTier(sourceTier);
  const score = calculatePriorityScore(article, signals);

  if (!hasVendorMatch) {
    if (hasEscapeHatchSignal) {
      reasons.add('cheap_filter_l1_severe_signal_escape_hatch');
      return buildFilterDecision('MAYBE_KEEP', Math.min(score, 49), reasons, blockingReasons, signals);
    }
    blockingReasons.add('cheap_filter_l1_no_vendor_no_severe_signal');
    blockingReasons.add('cheap_filter_insufficient_rss_signal');
    if (score < 15) blockingReasons.add('cheap_filter_low_score');
    return buildFilterDecision('DROP', score, reasons, blockingReasons, signals);
  }

  if (hasNegativeDominance(cves.length > 0 || keywords.critical.length > 0, keywords.negative)) {
    blockingReasons.add('cheap_filter_l2_negative_dominance');
    blockingReasons.add('cheap_filter_insufficient_rss_signal');
    return buildFilterDecision('DROP', score, reasons, blockingReasons, signals);
  }

  const hasCyberContext = hasLayer2CyberContext(signals);
  if (!hasCyberContext) {
    blockingReasons.add('cheap_filter_vendor_only_without_security_context');
    blockingReasons.add('cheap_filter_l2_no_cyber_context');
    blockingReasons.add('cheap_filter_insufficient_rss_signal');
    return buildFilterDecision('DROP', score, reasons, blockingReasons, signals);
  }

  if (vendors.products.length > 0) reasons.add('product_with_cyber_context');
  if (vendors.vendors.length > 0) reasons.add('vendor_with_cyber_context');
  if (isTrustedTier(sourceTier) || sourceTier === 'security_media' || sourceTier === 'researcher_blog') {
    reasons.add('trusted_source_with_security_context');
  }

  return buildFilterDecision(score >= 50 ? 'KEEP' : 'MAYBE_KEEP', score, reasons, blockingReasons, signals);
}

function buildFilterDecision(
  decision: CheapFilterDecision,
  score: number,
  reasons: Set<string>,
  blockingReasons: Set<string>,
  signals: CheapFilterSignals
): FilterDecision {
  const reasonList = Array.from(reasons);
  const blockingReasonList = Array.from(blockingReasons);
  if (reasonList.length === 0 && blockingReasonList.length === 0) {
    blockingReasonList.push('cheap_filter_insufficient_rss_signal');
  }

  const matchedSignals: CheapFilterMatchedSignals = {
    criticalCyberKeywords: signals.keywords.critical,
    mediumCyberKeywords: signals.keywords.medium,
    lowCyberKeywords: signals.keywords.low,
    negativeKeywords: signals.keywords.negative,
    cves: signals.cves,
    vendors: signals.vendors.vendors,
    products: signals.vendors.products,
    rssCategories: signals.securityCategories,
    sourceTier: signals.sourceTier,
  };

  return {
    decision,
    score: normalizeScore(score),
    reasons: reasonList,
    blockingReasons: blockingReasonList,
    matchedSignals,
    shouldExtract: decision !== 'DROP',
    cves: signals.cves,
    vendors: signals.vendors.vendors,
    products: signals.vendors.products,
  };
}

function addSignalReasons(
  article: CheapFilterInput,
  signals: CheapFilterSignals,
  reasons: Set<string>,
  blockingReasons: Set<string>
): void {
  const { cves, vendors, keywords, sourceTier, securityCategories } = signals;
  if (cves.length > 0) reasons.add('cve_found');
  if (vendors.products.length > 0) reasons.add('monitored_product_found');
  if (vendors.vendors.length > 0) reasons.add('monitored_vendor_found');
  if (keywords.critical.length > 0) reasons.add('critical_cyber_keyword_found');
  if (keywords.medium.length > 0) reasons.add('medium_cyber_keyword_found');
  if (keywords.low.length > 0) reasons.add('low_cyber_keyword_found');
  if (sourceTier === 'official_vendor') reasons.add('official_vendor_source');
  if (sourceTier === 'government_cert') reasons.add('government_cert_source');
  if (sourceTier === 'security_media') reasons.add('security_media_source');
  if (sourceTier === 'researcher_blog') reasons.add('researcher_blog_source');
  if (securityCategories.length > 0) reasons.add('security_rss_category_found');
  if (isRecent(article.publishedAt)) reasons.add('recent_article');
  if (keywords.negative.length > 0) blockingReasons.add('cheap_filter_negative_business_context');
}

function hasLayer2CyberContext(signals: CheapFilterSignals): boolean {
  const { keywords, cves, sourceTier, securityCategories, matchedInventory } = signals;
  if (cves.length > 0 || keywords.critical.length > 0 || isTrustedTier(sourceTier)) return true;
  if (keywords.medium.length === 0) return false;
  const corroborated = securityCategories.length > 0 || sourceTier === 'security_media' || sourceTier === 'researcher_blog';
  return matchedInventory.some((item) => item.newsVolume === 'noisy') ? corroborated : true;
}

function calculatePriorityScore(article: CheapFilterInput, signals: CheapFilterSignals): number {
  const { keywords, cves, vendors, sourceTier, securityCategories } = signals;
  let score = 0;
  if (cves.length > 0) score += 35;
  if (vendors.products.length > 0) score += 25;
  else if (vendors.vendors.length > 0) score += 15;
  if (keywords.criticalExploitation.length > 0) score += 35;
  else if (keywords.criticalIncident.length > 0) score += 25;
  else if (keywords.medium.length > 0) score += 20;
  else if (hasLowCombination(keywords.low)) score += 10;
  else if (keywords.low.length > 0) score += 5;
  if (sourceTier === 'official_vendor' || sourceTier === 'government_cert') score += 25;
  if (sourceTier === 'security_media' || sourceTier === 'researcher_blog') score += 10;
  if (securityCategories.length > 0) score += 10;
  if (isRecent(article.publishedAt)) score += 10;
  if (keywords.negative.length > 0) score -= 20;
  if (isOld(article.publishedAt)) score -= 20;
  return normalizeScore(score);
}

export async function runCheapFilterStage(
  db: Queryable,
  options: { limit?: number; inventory?: VendorProduct[] } = {}
): Promise<FilterStageResult> {
  const articles = new ArticleRepository(db);
  const inventory = options.inventory ?? (await loadMonitoredInventoryFromDb(db));
  const candidates = await articles.listByProcessingStatus('NEW', options.limit ?? 50);
  let extractionPending = 0;
  let extractionPendingLowPriority = 0;
  let ignored = 0;

  for (const article of candidates) {
    const decision = decideCheapFilter(article, inventory);
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

function findMatchedInventory(
  matchedVendors: string[],
  matchedProducts: string[],
  inventory: VendorProduct[]
): VendorProduct[] {
  const vendors = new Set(matchedVendors);
  const products = new Set(matchedProducts);
  return inventory.filter((item) => vendors.has(item.vendor) && (products.size === 0 || products.has(item.product)));
}

function isTrustedTier(sourceTier: SourceTier): boolean {
  return sourceTier === 'official_vendor' || sourceTier === 'government_cert';
}

function isRecent(publishedAt?: Date | null): boolean {
  if (!publishedAt) return false;
  return Date.now() - publishedAt.getTime() <= 24 * 60 * 60 * 1000;
}

function isOld(publishedAt?: Date | null): boolean {
  if (!publishedAt) return false;
  return Date.now() - publishedAt.getTime() > 14 * 24 * 60 * 60 * 1000;
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

function normalizeScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}
