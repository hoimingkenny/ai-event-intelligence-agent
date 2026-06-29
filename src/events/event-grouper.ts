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

export function buildEventDraft(article: ArticleRecord, entities: ArticleEntityRecord[]): EventDraft {
  const vendors = valuesByType(entities, 'vendor');
  const products = valuesByType(entities, 'product');
  const cves = valuesByType(entities, 'cve');
  const attackTypes = valuesByType(entities, 'attack_type');
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
