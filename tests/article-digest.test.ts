import { describe, expect, it } from 'vitest';
import {
  digestArticleAgainstInventory,
  normalizeArticleDigest,
} from '../src/llm/article-digest.js';
import type { ArticleRecord } from '../src/db/repositories/article.repository.js';
import type { VendorProduct } from '../src/types/domain.js';

const inventory: VendorProduct[] = [
  {
    id: 'vp_cyberark_pas',
    vendor: 'CyberArk',
    product: 'Privileged Access Security',
    aliases: ['CyberArk PAS', 'PAS'],
    criticality: 'critical',
    inProduction: true,
    newsVolume: 'quiet',
  },
  {
    id: 'vp_zscaler_zia',
    vendor: 'Zscaler',
    product: 'Zscaler Internet Access',
    aliases: ['ZIA'],
    criticality: 'high',
    inProduction: true,
    newsVolume: 'quiet',
  },
];

const article: ArticleRecord = {
  id: '1',
  feedId: null,
  sourceName: 'CISA',
  title: 'CyberArk PAS advisory',
  canonicalUrl: 'https://example.test/a',
  urlHash: null,
  titleHash: null,
  contentHash: null,
  rssSummary: 'Advisory for PAS',
  rssCategories: [],
  cleanText: 'CyberArk Privileged Access Security CVE-2026-1234 disclosure.',
  publishedAt: new Date('2026-07-01T08:00:00Z'),
  extractionStatus: 'http_success',
  extractionMethod: 'http',
  extractionError: null,
  processingStatus: 'ENTITY_EXTRACTED',
};

describe('digestArticleAgainstInventory', () => {
  it('includes inventory and asks for slim related/summary/CVE fields', async () => {
    let systemPrompt = '';
    let userPrompt = '';

    await digestArticleAgainstInventory(article, inventory, {
      call: async (system, user) => {
        systemPrompt = system;
        userPrompt = user;
        return {
          relatedToMonitoredInventory: true,
          incidentSummary: 'PAS vulnerability disclosure.',
          cves: ['CVE-2026-1234'],
          matchedVendors: ['CyberArk'],
          matchedProducts: ['Privileged Access Security'],
          confidence: 0.9,
          reasoning: 'Product advisory for monitored PAS.',
        };
      },
    });

    expect(systemPrompt).toContain('relatedToMonitoredInventory');
    expect(systemPrompt).toContain('incidentSummary');
    expect(systemPrompt).toContain('closed monitored inventory');
    expect(userPrompt).toContain('CyberArk');
    expect(userPrompt).toContain('Privileged Access Security');
    expect(userPrompt).toContain('CyberArk PAS');
  });

  it('normalizes unrelated digests to empty match fields', () => {
    const normalized = normalizeArticleDigest(
      {
        relatedToMonitoredInventory: false,
        incidentSummary: 'should clear',
        cves: ['CVE-2026-1'],
        matchedVendors: ['CyberArk'],
        matchedProducts: ['PAS'],
        confidence: 0.4,
        reasoning: 'Trend piece only.',
      },
      inventory
    );

    expect(normalized).toEqual({
      relatedToMonitoredInventory: false,
      incidentSummary: null,
      cves: [],
      matchedVendors: [],
      matchedProducts: [],
      confidence: 0.4,
      reasoning: 'Trend piece only.',
    });
  });

  it('maps aliases to canonical inventory product names and drops unknowns', () => {
    const normalized = normalizeArticleDigest(
      {
        relatedToMonitoredInventory: true,
        incidentSummary: 'PAS issue',
        cves: ['cve-2026-1234', 'not-a-cve'],
        matchedVendors: ['cyberark', 'Contoso'],
        matchedProducts: ['PAS', 'Unknown Product'],
        confidence: 0.8,
        reasoning: 'Alias match.',
      },
      inventory
    );

    expect(normalized.relatedToMonitoredInventory).toBe(true);
    expect(normalized.matchedVendors).toEqual(['CyberArk']);
    expect(normalized.matchedProducts).toEqual(['Privileged Access Security']);
    expect(normalized.cves).toEqual(['CVE-2026-1234']);
  });

  it('forces unrelated when no inventory matches survive filtering', () => {
    const normalized = normalizeArticleDigest(
      {
        relatedToMonitoredInventory: true,
        incidentSummary: 'Something',
        cves: ['CVE-2026-1'],
        matchedVendors: ['Contoso'],
        matchedProducts: ['Widget'],
        confidence: 0.7,
        reasoning: 'Hallucinated vendor.',
      },
      inventory
    );

    expect(normalized.relatedToMonitoredInventory).toBe(false);
    expect(normalized.incidentSummary).toBeNull();
    expect(normalized.cves).toEqual([]);
  });
});
