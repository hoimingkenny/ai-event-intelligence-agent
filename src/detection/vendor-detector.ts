import type { VendorProduct } from '../types/domain.js';

export interface VendorDetectionResult {
  vendors: string[];
  products: string[];
  matchedAliases: string[];
}

export function detectVendorsFromInventory(
  text: string,
  inventory: VendorProduct[]
): VendorDetectionResult {
  const matchedVendors = new Set<string>();
  const matchedProducts = new Set<string>();
  const matchedAliases = new Set<string>();

  for (const item of inventory) {
    const vendorAliases = [item.vendor, ...item.aliases];
    if (vendorAliases.some((alias) => containsPhrase(text, alias))) {
      matchedVendors.add(item.vendor);
      matchedAliases.add(item.vendor);
    }

    if (containsPhrase(text, item.product)) {
      matchedVendors.add(item.vendor);
      matchedProducts.add(item.product);
      matchedAliases.add(item.product);
    }

    for (const alias of item.aliases) {
      if (containsPhrase(text, alias)) {
        matchedVendors.add(item.vendor);
        matchedProducts.add(item.product);
        matchedAliases.add(alias);
      }
    }
  }

  return {
    vendors: Array.from(matchedVendors),
    products: Array.from(matchedProducts),
    matchedAliases: Array.from(matchedAliases),
  };
}

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}
