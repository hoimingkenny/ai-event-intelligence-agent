import type { VendorProduct } from '../../types/domain.js';

/** Fields an analyst labels as digest eval ground truth. */
export interface DigestGoldFields {
  relatedToMonitoredInventory: boolean;
  matchedVendors: string[];
  matchedProducts: string[];
  cves: string[];
  humanReason: string | null;
}

/** Frozen article text used when scoring prompt regen later. */
export interface DigestGoldArticleSnapshot {
  title: string | null;
  sourceName: string | null;
  rssSummary: string | null;
  cleanText: string | null;
}

export type DigestGoldInventorySnapshot = VendorProduct[];

export interface DigestGoldLabelRecord extends DigestGoldFields {
  id: string;
  articleId: string;
  articleSnapshot: DigestGoldArticleSnapshot;
  inventorySnapshot: DigestGoldInventorySnapshot;
  labeledBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const DIGEST_GOLD_TARGET_COUNT = 50;

export const DIGEST_GOLD_CLEAN_TEXT_SLICE = 12_000;

/** Canonical CVE id: CVE-YYYY-NNNNN (4+ digits in the sequence). */
export const CVE_ID_PATTERN = /^CVE-\d{4}-\d{4,}$/;

export function normalizeCveId(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  return CVE_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function normalizeCveList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeCveId(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function findInvalidCveEntries(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value) => normalizeCveId(value) === null);
}
