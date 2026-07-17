import { DigestGoldRepository } from '../db/repositories/digest-gold.repository.js';
import { listActiveMonitoredInventory } from '../db/monitored-inventory.js';
import type { Queryable } from '../db/repositories/types.js';
import type { VendorProduct } from '../types/domain.js';
import {
  DIGEST_GOLD_CLEAN_TEXT_SLICE,
  findInvalidCveEntries,
  normalizeCveList,
  type DigestGoldArticleSnapshot,
  type DigestGoldFields,
} from '../evaluation/digest/digest-gold-types.js';

export type DigestGoldWriteError =
  | 'article_not_found'
  | 'article_not_eligible'
  | 'related_requires_inventory_match'
  | 'invalid_inventory_vendor'
  | 'invalid_inventory_product'
  | 'invalid_cve';

export class DigestGoldWriteFailedError extends Error {
  constructor(public readonly code: DigestGoldWriteError, message?: string) {
    super(message ?? code);
    this.name = 'DigestGoldWriteFailedError';
  }
}

export interface UpsertDigestGoldArgs extends DigestGoldFields {
  articleId: string;
  labeledBy?: string | null;
}

function trimList(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function normalizeCves(values: string[]): string[] {
  const invalid = findInvalidCveEntries(values);
  if (invalid.length > 0) {
    throw new DigestGoldWriteFailedError(
      'invalid_cve',
      `Invalid CVE id(s): ${invalid.join(', ')}. Use CVE-YYYY-NNNNN.`
    );
  }
  return normalizeCveList(values);
}

function buildInventoryMaps(inventory: VendorProduct[]): {
  vendorByLower: Map<string, string>;
  productByLower: Map<string, string>;
} {
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
  return { vendorByLower, productByLower };
}

function canonicalizeVendors(values: string[], vendorByLower: Map<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const canonical = vendorByLower.get(value.trim().toLowerCase());
    if (!canonical) {
      throw new DigestGoldWriteFailedError(
        'invalid_inventory_vendor',
        `Unknown monitored vendor: ${value}`
      );
    }
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

function canonicalizeProducts(values: string[], productByLower: Map<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const canonical = productByLower.get(value.trim().toLowerCase());
    if (!canonical) {
      throw new DigestGoldWriteFailedError(
        'invalid_inventory_product',
        `Unknown monitored product: ${value}`
      );
    }
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

function normalizeGoldFields(
  fields: DigestGoldFields,
  inventory: VendorProduct[]
): DigestGoldFields {
  const { vendorByLower, productByLower } = buildInventoryMaps(inventory);
  const cves = normalizeCves(trimList(fields.cves));
  const humanReason = fields.humanReason?.trim() || null;

  if (!fields.relatedToMonitoredInventory) {
    return {
      relatedToMonitoredInventory: false,
      matchedVendors: [],
      matchedProducts: [],
      cves,
      humanReason,
    };
  }

  const matchedVendors = canonicalizeVendors(trimList(fields.matchedVendors), vendorByLower);
  const matchedProducts = canonicalizeProducts(trimList(fields.matchedProducts), productByLower);

  if (matchedVendors.length === 0 && matchedProducts.length === 0) {
    throw new DigestGoldWriteFailedError(
      'related_requires_inventory_match',
      'Related gold must name at least one monitored vendor or product.'
    );
  }

  return {
    relatedToMonitoredInventory: true,
    matchedVendors,
    matchedProducts,
    cves,
    humanReason,
  };
}

function buildArticleSnapshot(row: {
  title: string | null;
  source_name: string | null;
  rss_summary: string | null;
  clean_text: string | null;
}): DigestGoldArticleSnapshot {
  const clean = row.clean_text?.trim() ? row.clean_text : null;
  return {
    title: row.title,
    sourceName: row.source_name,
    rssSummary: row.rss_summary,
    cleanText: clean ? clean.slice(0, DIGEST_GOLD_CLEAN_TEXT_SLICE) : null,
  };
}

export async function upsertDigestGold(
  args: UpsertDigestGoldArgs,
  db: Queryable
): Promise<void> {
  const articleResult = await db.query<{
    id: string;
    processing_status: string;
    title: string | null;
    source_name: string | null;
    rss_summary: string | null;
    clean_text: string | null;
    llm_article_digest: unknown;
  }>(
    `
      SELECT id, processing_status, title, source_name, rss_summary, clean_text, llm_article_digest
      FROM articles
      WHERE id = $1
    `,
    [args.articleId]
  );
  const article = articleResult.rows[0];
  if (!article) {
    throw new DigestGoldWriteFailedError('article_not_found');
  }

  const eligible =
    article.processing_status === 'DIGESTED' || article.llm_article_digest != null;
  if (!eligible) {
    throw new DigestGoldWriteFailedError(
      'article_not_eligible',
      'Article must be DIGESTED or have an LLM digest before saving gold.'
    );
  }

  const inventory = await listActiveMonitoredInventory(db);
  const normalized = normalizeGoldFields(args, inventory);
  const repo = new DigestGoldRepository(db);

  await repo.upsert({
    articleId: args.articleId,
    ...normalized,
    articleSnapshot: buildArticleSnapshot(article),
    inventorySnapshot: inventory,
    labeledBy: args.labeledBy ?? null,
  });
}
