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

const relatedPayload = {
  relatedToMonitoredInventory: true,
  incidentSummary: 'PAS vulnerability disclosure.',
  cves: ['CVE-2026-1234'],
  matchedVendors: ['CyberArk'],
  matchedProducts: ['Privileged Access Security'],
  mentionedVendors: ['CyberArk'],
  mentionedProducts: ['Privileged Access Security'],
  affectedOrganizations: [],
  confidence: 0.9,
  reasoning: 'Product advisory for monitored PAS.',
};

describe('digestArticleAgainstInventory', () => {
  it('includes inventory and asks for open-world actor fields', async () => {
    let systemPrompt = '';
    let userPrompt = '';

    await digestArticleAgainstInventory(article, inventory, {
      call: async (system, user) => {
        systemPrompt = system;
        userPrompt = user;
        return relatedPayload;
      },
    });

    expect(systemPrompt).toContain('relatedToMonitoredInventory');
    expect(systemPrompt).toContain('mentionedVendors');
    expect(systemPrompt).toContain('affectedOrganizations');
    expect(systemPrompt).toContain('closed monitored inventory');
    expect(userPrompt).toContain('CyberArk');
    expect(userPrompt).toContain('Privileged Access Security');
  });

  it('keeps summary/CVEs/open-world actors when unrelated; clears inventory matches', () => {
    const normalized = normalizeArticleDigest(
      {
        relatedToMonitoredInventory: false,
        incidentSummary: 'AcmeCorp VPN zero-day exploited.',
        cves: ['CVE-2026-1111'],
        matchedVendors: ['CyberArk'],
        matchedProducts: ['PAS'],
        mentionedVendors: ['AcmeCorp'],
        mentionedProducts: ['Acme VPN'],
        affectedOrganizations: ['Contoso'],
        confidence: 0.7,
        reasoning: 'Not in our monitored inventory.',
      },
      inventory
    );

    expect(normalized).toEqual({
      relatedToMonitoredInventory: false,
      incidentSummary: 'AcmeCorp VPN zero-day exploited.',
      cves: ['CVE-2026-1111'],
      matchedVendors: [],
      matchedProducts: [],
      mentionedVendors: ['AcmeCorp'],
      mentionedProducts: ['Acme VPN'],
      affectedOrganizations: ['Contoso'],
      confidence: 0.7,
      reasoning: 'Not in our monitored inventory.',
    });
  });

  it('maps aliases to canonical inventory product names and drops unknowns from matched*', () => {
    const normalized = normalizeArticleDigest(
      {
        relatedToMonitoredInventory: true,
        incidentSummary: 'PAS issue',
        cves: ['cve-2026-1234', 'not-a-cve'],
        matchedVendors: ['cyberark', 'Contoso'],
        matchedProducts: ['PAS', 'Unknown Product'],
        mentionedVendors: ['CyberArk', 'Contoso'],
        mentionedProducts: ['PAS'],
        affectedOrganizations: [],
        confidence: 0.8,
        reasoning: 'Alias match.',
      },
      inventory
    );

    expect(normalized.relatedToMonitoredInventory).toBe(true);
    expect(normalized.matchedVendors).toEqual(['CyberArk']);
    expect(normalized.matchedProducts).toEqual(['Privileged Access Security']);
    expect(normalized.mentionedVendors).toEqual(['CyberArk', 'Contoso']);
    expect(normalized.cves).toEqual(['CVE-2026-1234']);
  });

  it('forces unrelated when no inventory matches survive filtering but keeps open-world fields', () => {
    const normalized = normalizeArticleDigest(
      {
        relatedToMonitoredInventory: true,
        incidentSummary: 'Widget zero-day at Contoso',
        cves: ['CVE-2026-0001'],
        matchedVendors: ['Contoso'],
        matchedProducts: ['Widget'],
        mentionedVendors: ['Contoso Soft'],
        mentionedProducts: ['Widget'],
        affectedOrganizations: ['Contoso'],
        confidence: 0.7,
        reasoning: 'Hallucinated inventory match.',
      },
      inventory
    );

    expect(normalized.relatedToMonitoredInventory).toBe(false);
    expect(normalized.incidentSummary).toBe('Widget zero-day at Contoso');
    expect(normalized.cves).toEqual(['CVE-2026-0001']);
    expect(normalized.matchedVendors).toEqual([]);
    expect(normalized.matchedProducts).toEqual([]);
    expect(normalized.mentionedVendors).toEqual(['Contoso Soft']);
    expect(normalized.affectedOrganizations).toEqual(['Contoso']);
  });
});
