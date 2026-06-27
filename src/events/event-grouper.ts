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
  };
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
