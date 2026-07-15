import type { ArticleEntityInput } from '../db/repositories/entity.repository.js';
import { detectCyberKeywords } from './cyber-keyword-detector.js';
import { extractCves } from './cve-extractor.js';
import { buildZonedText, locatePhrase, scoreEntity } from './entity-confidence.js';
import { extractIocs } from './ioc-extractor.js';
import { detectVendorsFromInventory } from './vendor-detector.js';
import type { VendorProduct } from '../types/domain.js';

export interface ArticleEntityFields {
  title?: string | null;
  summary?: string | null;
  body?: string | null;
}

/**
 * Extracts entities with a confidence derived from placement and corroboration
 * (see entity-confidence.ts). Callers pass the article's fields separately —
 * the zoned scoring depends on knowing title vs body vs tail, so a
 * pre-flattened string loses the signal that makes noise entities weak.
 */
export function extractArticleEntities(
  articleId: string,
  fields: ArticleEntityFields,
  inventory: VendorProduct[]
): ArticleEntityInput[] {
  const zones = buildZonedText(fields);
  const fullText = Object.values(zones).join('\n');

  const vendors = detectVendorsFromInventory(fullText, inventory);
  const cves = extractCves(fullText);
  const iocs = extractIocs(fullText);
  const keywords = detectCyberKeywords(fullText);

  // Corroboration: does the article carry security context at all?
  const corroborated = keywords.matchedKeywords.length > 0 || cves.length > 0;

  const entities: ArticleEntityInput[] = [];
  const score = (entityType: string, value: string): number => {
    const located = locatePhrase(zones, value);
    return scoreEntity({
      entityType,
      zones: located.zones,
      occurrences: located.occurrences,
      corroborated,
    });
  };

  for (const vendor of vendors.vendors) {
    entities.push({
      articleId,
      entityType: 'vendor',
      entityValue: vendor,
      role: 'unknown',
      confidence: score('vendor', vendor),
    });
  }
  for (const product of vendors.products) {
    entities.push({
      articleId,
      entityType: 'product',
      entityValue: product,
      role: 'unknown',
      confidence: score('product', product),
    });
  }
  for (const cve of cves) {
    entities.push({ articleId, entityType: 'cve', entityValue: cve, confidence: score('cve', cve) });
  }
  for (const ip of iocs.ips) {
    entities.push({ articleId, entityType: 'ioc_ip', entityValue: ip, confidence: score('ioc_ip', ip) });
  }
  for (const domain of iocs.domains) {
    entities.push({
      articleId,
      entityType: 'ioc_domain',
      entityValue: domain,
      confidence: score('ioc_domain', domain),
    });
  }
  for (const hash of iocs.hashes) {
    entities.push({
      articleId,
      entityType: 'ioc_hash',
      entityValue: hash,
      confidence: score('ioc_hash', hash),
    });
  }
  for (const keyword of keywords.matchedKeywords) {
    entities.push({
      articleId,
      entityType: 'attack_type',
      entityValue: keyword,
      confidence: score('attack_type', keyword),
    });
  }

  return dedupeEntities(entities);
}

function dedupeEntities(entities: ArticleEntityInput[]): ArticleEntityInput[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    const key = `${entity.entityType}:${entity.entityValue}:${entity.role ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
