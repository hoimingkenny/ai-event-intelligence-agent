import { callLLMWithSchema } from '../agents/llmHelpers.js';
import type { ArticleRecord } from '../db/repositories/article.repository.js';
import type { VendorProduct } from '../types/domain.js';
import { ArticleDigestSchema, type ArticleDigest } from './schemas.js';

export type SchemaCaller<T> = (systemPrompt: string, userPrompt: string) => Promise<T>;

export const ARTICLE_DIGEST_PROMPT_VERSION = 'article-digest-v2';

const systemPrompt = [
  'You assess cyber news articles for analyst triage.',
  'First, describe what security issue (if any) the article is about — even when it is NOT about our inventory.',
  'Then decide whether it relates to OUR monitored vendor products.',
  'Exploitation in the wild is NOT required — product advisories and vulnerability disclosures count as related.',
  'Generic cyber commentary or industry trends with no concrete vulnerability/incident/advisory are not related.',
  'Vendor-only mentions (no clear product) MAY be related when the article describes a security',
  'issue for that vendor; prefer matching a specific monitored product when possible.',
  'You are given a closed monitored inventory. matchedVendors and matchedProducts MUST use names',
  'exactly as listed in that inventory (vendor / product fields), never invent other names.',
  'mentionedVendors, mentionedProducts, and affectedOrganizations are open-world: any vendors,',
  'products, or victim/customer organizations named in the article (may overlap inventory names).',
  'Return strict JSON only, with exactly these top-level keys:',
  'relatedToMonitoredInventory, incidentSummary, cves, matchedVendors, matchedProducts,',
  'mentionedVendors, mentionedProducts, affectedOrganizations, confidence, reasoning.',
  'relatedToMonitoredInventory is a boolean.',
  'incidentSummary is a short plain-language description of the vulnerability/incident/advisory,',
  'or null only when the article has no security substance to summarize.',
  'cves is an array of CVE IDs mentioned (empty if none) — fill even when unrelated to inventory.',
  'If relatedToMonitoredInventory is false: matchedVendors and matchedProducts must be empty arrays;',
  'still fill incidentSummary (when applicable), cves, mentionedVendors, mentionedProducts,',
  'affectedOrganizations, and explain in reasoning why it is not related to our inventory.',
  'If relatedToMonitoredInventory is true: matchedVendors and/or matchedProducts list the inventory items implicated.',
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

/** Enforce closed-list inventory matches; keep open-world fields for analyst review. */
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
      if (alias.toLowerCase() === item.vendor.toLowerCase()) {
        vendorByLower.set(alias.toLowerCase(), item.vendor);
      }
    }
  }

  const matchedVendors = uniqueCanonical(digest.matchedVendors, vendorByLower);
  const matchedProducts = uniqueCanonical(digest.matchedProducts, productByLower);
  const cves = normalizeCves(digest.cves);
  const mentionedVendors = uniqueTrimmed(digest.mentionedVendors);
  const mentionedProducts = uniqueTrimmed(digest.mentionedProducts);
  const affectedOrganizations = uniqueTrimmed(digest.affectedOrganizations);
  const incidentSummary = digest.incidentSummary?.trim() || null;

  let related = digest.relatedToMonitoredInventory;
  if (related && matchedVendors.length === 0 && matchedProducts.length === 0) {
    related = false;
  }

  return {
    relatedToMonitoredInventory: related,
    incidentSummary,
    cves,
    matchedVendors: related ? matchedVendors : [],
    matchedProducts: related ? matchedProducts : [],
    mentionedVendors,
    mentionedProducts,
    affectedOrganizations,
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

function uniqueTrimmed(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
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
