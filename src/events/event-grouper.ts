import type { ArticleRecord } from '../db/repositories/article.repository.js';
import type { ArticleEntityRecord } from '../db/repositories/entity.repository.js';

export interface EventDraft {
  title: string;
  summary: string;
  affectedVendors: string[];
  affectedProducts: string[];
  cves: string[];
  attackTypes: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  urgency: 'P1' | 'P2' | 'P3' | 'P4';
  groupingKey: string;
}

/**
 * Entity-boundary gate (family C): only entities at or above this confidence
 * drive an event's affected vendors/products and its grouping key. A
 * low-confidence footer/related-link vendor is kept on the article (for audit)
 * but never manufactures a false event or alert. Perfect extraction is
 * impossible, so noise is tolerated at extraction and gated here.
 */
export const MIN_EVENT_ENTITY_CONFIDENCE = 0.5;

export function buildEventDraft(
  article: ArticleRecord,
  entities: ArticleEntityRecord[],
  options: { minConfidence?: number } = {}
): EventDraft {
  const minConfidence = options.minConfidence ?? MIN_EVENT_ENTITY_CONFIDENCE;
  const trusted = entities.filter(
    (entity) => (entity.confidence ?? 0) >= minConfidence
  );
  const vendors = valuesByType(trusted, 'vendor');
  const products = valuesByType(trusted, 'product');
  const cves = valuesByType(trusted, 'cve');
  const attackTypes = valuesByType(trusted, 'attack_type');
  const subject = [...vendors, ...products, ...cves].slice(0, 3).join(' / ') || 'Unknown cyber event';
  const title = cves.length > 0 ? `${subject} vulnerability report` : `${subject} cyber report`;
  const severe = attackTypes.some((type) =>
    ['active exploitation', 'zero-day', 'ransomware', 'breach'].includes(type)
  );

  return {
    title,
    summary: article.cleanText?.slice(0, 500) || article.rssSummary || article.title || title,
    affectedVendors: vendors,
    affectedProducts: products,
    cves,
    attackTypes,
    severity: severe || cves.length > 0 ? 'high' : 'medium',
    urgency: severe ? 'P1' : cves.length > 0 ? 'P2' : 'P3',
    groupingKey: buildEventGroupingKey({ vendors, products, cves, attackTypes }),
  };
}

export function buildEventGroupingKey(input: {
  vendors: string[];
  products: string[];
  cves: string[];
  attackTypes: string[];
}): string {
  if (input.cves.length > 0) {
    return `cve:${input.cves.map(normalizeKeyPart).sort().join('|')}`;
  }

  const vendorProductKey = [...input.vendors, ...input.products].map(normalizeKeyPart).sort().join('|');
  const attackKey = input.attackTypes.map(normalizeKeyPart).sort().join('|');
  return [vendorProductKey, attackKey].filter(Boolean).join('::') || 'unknown';
}

function valuesByType(entities: ArticleEntityRecord[], type: string): string[] {
  return Array.from(
    new Set(
      entities
        .filter((entity) => entity.entityType === type)
        .map((entity) => entity.entityValue)
    )
  );
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
