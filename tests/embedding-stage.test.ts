import { describe, expect, it } from 'vitest';
import { vectorToSqlLiteral } from '../src/db/repositories/article.repository.js';
import { buildArticleEmbeddingText, buildEventEmbeddingText } from '../src/embedding/embedding-client.js';

describe('embedding helpers', () => {
  it('serializes vectors for pgvector parameters', () => {
    expect(vectorToSqlLiteral([0.1, -2, 3])).toBe('[0.1,-2,3]');
  });

  it('builds bounded embedding text from article fields', () => {
    const text = buildArticleEmbeddingText({
      title: 'Vendor advisory',
      rssSummary: 'Summary',
      cleanText: 'A'.repeat(13000),
    });

    expect(text.startsWith('Vendor advisory\nSummary\n')).toBe(true);
    expect(text.length).toBe(12000);
  });

  it('builds bounded embedding text from event fields', () => {
    const text = buildEventEmbeddingText({
      eventTitle: 'Active exploitation of Vendor VPN',
      eventSummary: 'Attackers are exploiting CVE-2026-1234.',
      severity: 'critical',
      urgency: 'immediate',
      affectedVendors: ['Vendor'],
      affectedProducts: ['VPN'],
      cves: ['CVE-2026-1234'],
      attackTypes: ['active_exploitation'],
    });

    expect(text).toContain('Active exploitation of Vendor VPN');
    expect(text).toContain('Vendors: Vendor');
    expect(text).toContain('CVEs: CVE-2026-1234');
  });
});
