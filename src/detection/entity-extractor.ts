import type { ArticleEntityInput } from '../db/repositories/entity.repository.js';
import { monitoredVendors } from '../storage/vendorInventory.js';
import { detectCyberKeywords } from './cyber-keyword-detector.js';
import { extractCves } from './cve-extractor.js';
import { extractIocs } from './ioc-extractor.js';
import { detectVendorsFromInventory } from './vendor-detector.js';

export function extractArticleEntities(articleId: string, text: string): ArticleEntityInput[] {
  const entities: ArticleEntityInput[] = [];
  const vendors = detectVendorsFromInventory(text, monitoredVendors);
  const cves = extractCves(text);
  const iocs = extractIocs(text);
  const keywords = detectCyberKeywords(text);

  for (const vendor of vendors.vendors) {
    entities.push({ articleId, entityType: 'vendor', entityValue: vendor, role: 'unknown' });
  }
  for (const product of vendors.products) {
    entities.push({ articleId, entityType: 'product', entityValue: product, role: 'unknown' });
  }
  for (const cve of cves) {
    entities.push({ articleId, entityType: 'cve', entityValue: cve });
  }
  for (const ip of iocs.ips) {
    entities.push({ articleId, entityType: 'ioc_ip', entityValue: ip });
  }
  for (const domain of iocs.domains) {
    entities.push({ articleId, entityType: 'ioc_domain', entityValue: domain });
  }
  for (const hash of iocs.hashes) {
    entities.push({ articleId, entityType: 'ioc_hash', entityValue: hash });
  }
  for (const keyword of keywords.matchedKeywords) {
    entities.push({ articleId, entityType: 'attack_type', entityValue: keyword });
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
