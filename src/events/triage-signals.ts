/**
 * Slim Needs-triage skim signals: presence + tooltip names for the list row.
 * Combines cheap-filter matchedSignals with article_entities (OR for presence).
 */

export interface TriageEntityHit {
  entityType: string;
  entityValue: string;
}

export interface TriageSignalSummary {
  hasVendorOrProduct: boolean;
  hasCve: boolean;
  hasCriticalKeyword: boolean;
  vendorProductNames: string[];
  cveIds: string[];
  criticalKeywords: string[];
}

type MatchedSignalsLike = {
  vendors?: unknown;
  products?: unknown;
  cves?: unknown;
  criticalCyberKeywords?: unknown;
};

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) out.push(item.trim());
  }
  return out;
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function summarizeTriageSignals(
  matchedSignals: unknown,
  entities: TriageEntityHit[]
): TriageSignalSummary {
  const signals =
    matchedSignals && typeof matchedSignals === 'object'
      ? (matchedSignals as MatchedSignalsLike)
      : {};

  const filterVendors = asStringList(signals.vendors);
  const filterProducts = asStringList(signals.products);
  const filterCves = asStringList(signals.cves);
  const criticalKeywords = dedupePreserveOrder(asStringList(signals.criticalCyberKeywords));

  const entityVendors = entities
    .filter((e) => e.entityType === 'vendor')
    .map((e) => e.entityValue);
  const entityProducts = entities
    .filter((e) => e.entityType === 'product')
    .map((e) => e.entityValue);
  const entityCves = entities.filter((e) => e.entityType === 'cve').map((e) => e.entityValue);

  const vendorProductNames = dedupePreserveOrder([
    ...filterVendors,
    ...filterProducts,
    ...entityVendors,
    ...entityProducts,
  ]);
  const cveIds = dedupePreserveOrder([...filterCves, ...entityCves]);

  return {
    hasVendorOrProduct: vendorProductNames.length > 0,
    hasCve: cveIds.length > 0,
    hasCriticalKeyword: criticalKeywords.length > 0,
    vendorProductNames,
    cveIds,
    criticalKeywords,
  };
}
