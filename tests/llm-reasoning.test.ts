import { describe, expect, it } from 'vitest';
import { classifyCyberArticle } from '../src/llm/cyber-classifier.js';
import { compareArticleToEvent } from '../src/llm/event-comparator.js';
import { summarizeEvent } from '../src/llm/summarizer.js';
import type { ArticleRecord } from '../src/db/repositories/article.repository.js';
import type { EventRecord } from '../src/db/repositories/event.repository.js';

const article: ArticleRecord = {
  id: '1',
  feedId: null,
  sourceName: 'Source',
  title: 'Vendor VPN exploited',
  canonicalUrl: 'https://example.test',
  urlHash: null,
  titleHash: null,
  contentHash: null,
  rssSummary: 'Summary',
  cleanText: 'Attackers exploit CVE-2026-1234 in Vendor VPN.',
  publishedAt: null,
  extractionStatus: 'http_success',
  extractionMethod: 'http',
  extractionError: null,
  processingStatus: 'GROUPED',
};

const event: EventRecord = {
  id: '1',
  eventTitle: 'Vendor VPN vulnerability report',
  eventSummary: 'Existing event',
  eventStatus: 'open',
  severity: 'high',
  urgency: 'P2',
  confidence: 0.7,
  affectedVendors: ['Vendor'],
  affectedProducts: ['VPN'],
  cves: ['CVE-2026-1234'],
  attackTypes: ['active_exploitation'],
};

describe('LLM reasoning wrappers', () => {
  it('classifies cyber articles through an injectable schema caller', async () => {
    const result = await classifyCyberArticle(article, {
      call: async () => ({
        cyberRelevant: true,
        eventType: 'active_exploitation',
        severity: 'critical',
        urgency: 'P1',
        confidence: 0.95,
        vendorRoles: [{ vendor: 'Vendor', role: 'affected', rationale: 'VPN is exploited.' }],
        affectedProducts: ['VPN'],
        cves: ['CVE-2026-1234'],
        reasoning: 'Clear exploitation.',
      }),
    });

    expect(result.cyberRelevant).toBe(true);
    expect(result.vendorRoles[0].role).toBe('affected');
  });

  it('compares article and event candidates', async () => {
    const result = await compareArticleToEvent(article, event, {
      call: async () => ({
        relationship: 'same_event',
        confidence: 0.91,
        isMaterialUpdate: true,
        rationale: 'Same CVE and product.',
      }),
    });

    expect(result.relationship).toBe('same_event');
    expect(result.isMaterialUpdate).toBe(true);
  });

  it('summarizes event context', async () => {
    const result = await summarizeEvent(event, [article], {
      call: async () => ({
        title: 'Vendor VPN active exploitation',
        summary: 'Attackers are exploiting Vendor VPN.',
        severity: 'critical',
        urgency: 'P1',
        confidence: 0.9,
        keyFacts: ['CVE-2026-1234 is involved.'],
        recommendedActions: ['Apply vendor mitigation.'],
      }),
    });

    expect(result.title).toContain('Vendor VPN');
    expect(result.recommendedActions).toHaveLength(1);
  });
});
