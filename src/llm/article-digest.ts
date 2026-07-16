import { callLLMWithSchema } from '../agents/llmHelpers.js';
import type { ArticleRecord } from '../db/repositories/article.repository.js';
import type { VendorProduct } from '../types/domain.js';
import { ArticleDigestSchema, type ArticleDigest } from './schemas.js';

export type SchemaCaller<T> = (systemPrompt: string, userPrompt: string) => Promise<T>;

export const ARTICLE_DIGEST_PROMPT_VERSION = 'article-digest-v1';

const systemPrompt = [
  'You assess whether a cyber news article is about a vulnerability, security incident,',
  'cyber attack, exploit, or product security advisory that relates to OUR monitored vendor products.',
  'Exploitation in the wild is NOT required — product advisories and vulnerability disclosures count.',
  'Generic cyber commentary, industry trends, or articles that only name-drop a vendor without a',
  'security issue for that vendor/product are NOT related.',
  'Vendor-only mentions (no clear product) MAY be related when the article describes a security',
  'issue for that vendor; prefer matching a specific monitored product when possible.',
  'You are given a closed monitored inventory. matchedVendors and matchedProducts MUST use names',
  'exactly as listed in that inventory (vendor / product fields), never invent other names.',
  'Return strict JSON only, with exactly these top-level keys:',
  'relatedToMonitoredInventory, incidentSummary, cves, matchedVendors, matchedProducts, confidence, reasoning.',
  'relatedToMonitoredInventory is a boolean.',
  'If relatedToMonitoredInventory is false: incidentSummary must be null; cves, matchedVendors,',
  'and matchedProducts must be empty arrays; explain why in reasoning.',
  'If relatedToMonitoredInventory is true: incidentSummary is a short plain-language description',
  'of what happened or was disclosed; cves is an array of CVE IDs (empty if none);',
  'matchedVendors and matchedProducts list the inventory items implicated.',
  'Use confidence as a number from 0 to 1, not a string.',
  'reasoning must always be a non-empty string.',
].join(' ');

export async function digestArticleAgainstInventory(
  article: ArticleRecord,
  inventory: VendorProduct[],
  options: { call?: SchemaCaller<ArticleDigest> } = {}
): Promise<ArticleDigest> {
  const call =
    options.call ??
    ((system, user) => callLLMWithSchema(system, user, ArticleDigestSchema, { temperature: 0.1 }));

  const raw = await call(
    systemPrompt,
    JSON.stringify({
      monitoredInventory: inventory.map((item) => ({
        vendor: item.vendor,
        product: item.product,
        aliases: item.aliases,
      })),
      article: {
        title: article.title,
        sourceName: article.sourceName,
        rssSummary: article.rssSummary,
        cleanText: article.cleanText?.slice(0, 12000),
      },
    })
  );

  return normalizeArticleDigest(raw, inventory);
}

/** Enforce closed-list matches and empty fields when unrelated. */
export function normalizeArticleDigest(
  digest: ArticleDigest,
  inventory: VendorProduct[]
): ArticleDigest {
  const vendorByLower = new Map<string, string>();
  const productByLower = new Map<string, string>();
  for (const item of inventory) {
    vendorByLower.set(item.vendor.toLowerCase(), item.vendor);
    productByLower.set(item.product.toLowerCase(), item.product);
    for (const alias of item.aliases) {
      productByLower.set(alias.toLowerCase(), item.product);
      // Aliases that equal the vendor name should not invent products.
      if (alias.toLowerCase() === item.vendor.toLowerCase()) {
        vendorByLower.set(alias.toLowerCase(), item.vendor);
      }
    }
  }

  const matchedVendors = uniqueCanonical(digest.matchedVendors, vendorByLower);
  const matchedProducts = uniqueCanonical(digest.matchedProducts, productByLower);
  const cves = normalizeCves(digest.cves);

  let related = digest.relatedToMonitoredInventory;
  if (related && matchedVendors.length === 0 && matchedProducts.length === 0) {
    related = false;
  }

  if (!related) {
    return {
      relatedToMonitoredInventory: false,
      incidentSummary: null,
      cves: [],
      matchedVendors: [],
      matchedProducts: [],
      confidence: digest.confidence,
      reasoning: digest.reasoning,
    };
  }

  return {
    relatedToMonitoredInventory: true,
    incidentSummary: digest.incidentSummary?.trim() || null,
    cves,
    matchedVendors,
    matchedProducts,
    confidence: digest.confidence,
    reasoning: digest.reasoning,
  };
}

function uniqueCanonical(values: string[], canon: Map<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const canonical = canon.get(value.trim().toLowerCase());
    if (!canonical) continue;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

function normalizeCves(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const match = value.trim().toUpperCase().match(/CVE-\d{4}-\d{4,}/);
    if (!match) continue;
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    out.push(match[0]);
  }
  return out;
}
