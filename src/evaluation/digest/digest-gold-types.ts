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
