import { describe, expect, it } from 'vitest';
import { classifyCyberArticle } from '../src/llm/cyber-classifier.js';
import { summarizeEvent } from '../src/llm/summarizer.js';
import type { ArticleRecord } from '../src/db/repositories/article.repository.js';
import type { EventRecord } from '../src/db/repositories/event.repository.js';

const article: ArticleRecord = {
  id: '1',
  feedId: null,
  sourceName: 'Source',
  title: 'Vendor VPN exploited',
  canonicalUrl: 'https://example.test/a',
  urlHash: null,
  titleHash: null,
  contentHash: null,
  rssSummary: 'Attackers exploit Vendor VPN.',
  rssCategories: [],
  cleanText: 'Attackers exploit CVE-2026-1234 in Vendor VPN.',
  publishedAt: new Date('2026-07-01T08:00:00Z'),
  fetchedAt: new Date('2026-07-01T08:05:00Z'),
  extractedAt: null,
  extractionStatus: 'http_success',
  extractionMethod: 'http',
  extractionError: null,
  processingStatus: 'GROUPED',
};

const event: EventRecord = {
  id: '10',
  groupingKey: 'cve:cve-2026-1234',
  firstSeenAt: new Date('2026-07-01T08:00:00Z'),
  eventTitle: 'Draft title',
  eventSummary: 'Draft summary',
  eventStatus: 'open',
  publicationStatus: 'draft',
  severity: 'high',
  urgency: 'P2',
  confidence: 0.7,
  affectedVendors: ['Vendor'],
  affectedProducts: ['VPN'],
  cves: ['CVE-2026-1234'],
  attackTypes: ['active_exploitation'],
  summaryStale: true,
};

describe('LLM prompt contracts', () => {
  it('tells the cyber classifier the exact JSON fields and scalar formats', async () => {
    let systemPrompt = '';

    await classifyCyberArticle(article, {
      call: async (system) => {
        systemPrompt = system;
        return {
          cyberRelevant: true,
          eventType: 'active_exploitation',
          severity: 'critical',
          urgency: 'P1',
          confidence: 0.9,
          vendorRoles: [{ vendor: 'Vendor', role: 'affected', rationale: 'Product is exploited.' }],
          affectedProducts: ['VPN'],
          cves: ['CVE-2026-1234'],
          reasoning: 'Active exploitation is described.',
        };
      },
    });

    expect(systemPrompt).toContain('cyberRelevant, eventType, severity, urgency, confidence');
    expect(systemPrompt).toContain('confidence as a number from 0 to 1, not a string');
    expect(systemPrompt).toContain('affectedProducts and cves must always be arrays');
  });

  it('tells the event summarizer the exact JSON fields and scalar formats', async () => {
    let systemPrompt = '';

    await summarizeEvent(event, [article], {
      call: async (system) => {
        systemPrompt = system;
        return {
          title: 'Vendor VPN exploitation is active',
          summary: 'Attackers are exploiting Vendor VPN; review exposure.',
          severity: 'critical',
          urgency: 'P1',
          confidence: 0.91,
          keyFacts: ['CVE-2026-1234 is referenced.'],
          recommendedActions: ['Check affected VPN exposure.'],
        };
      },
    });

    expect(systemPrompt).toContain('title, summary, severity, urgency, confidence');
    expect(systemPrompt).toContain('confidence as a number from 0 to 1, not a string');
    expect(systemPrompt).toContain('keyFacts and recommendedActions must always be arrays');
  });
});
