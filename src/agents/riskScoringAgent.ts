import type { ExtractedCyberFacts } from '../types/domain.js';
import { monitoredVendors } from '../storage/vendorInventory.js';

export function scoreRisk(facts: ExtractedCyberFacts): 'low' | 'medium' | 'high' | 'critical' {
  let score = 0;

  if (facts.vendors.length > 0) score += 2;
  if (facts.products.length > 0) score += 2;
  if (facts.cveIds.length > 0) score += 1;
  if (facts.eventType === 'active_exploitation') score += 4;
  if (facts.eventType === 'ransomware') score += 3;
  if (facts.eventType === 'zero_day') score += 4;

  const prodCriticality = monitoredVendors
    .filter((item) => facts.vendors.includes(item.vendor) || facts.products.includes(item.product))
    .some((item) => item.inProduction && ['high', 'critical'].includes(item.criticality));

  if (prodCriticality) score += 3;

  if (score >= 10) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}
