import { describe, expect, it } from 'vitest';
import { buildEventDraft, buildEventGroupingKey } from '../src/events/event-grouper.js';

describe('buildEventDraft', () => {
  it('builds an event draft from article entities', () => {
    const draft = buildEventDraft(
      {
        id: '1',
        feedId: null,
        sourceName: 'Test',
        title: 'SailPoint advisory',
        canonicalUrl: 'https://example.test',
        urlHash: null,
        titleHash: null,
        contentHash: null,
        rssSummary: 'Summary',
        cleanText: 'SailPoint IdentityIQ CVE-2026-12345 active exploitation.',
        publishedAt: null,
        extractionStatus: 'http_success',
        extractionMethod: 'http',
        extractionError: null,
        processingStatus: 'ENTITY_EXTRACTED',
      },
      [
        { id: '1', articleId: '1', entityType: 'vendor', entityValue: 'SailPoint', role: null },
        { id: '2', articleId: '1', entityType: 'product', entityValue: 'IdentityIQ', role: null },
        { id: '3', articleId: '1', entityType: 'cve', entityValue: 'CVE-2026-12345', role: null },
        { id: '4', articleId: '1', entityType: 'attack_type', entityValue: 'active exploitation', role: null },
      ]
    );

    expect(draft.title).toContain('CVE-2026-12345');
    expect(draft.severity).toBe('high');
    expect(draft.urgency).toBe('P1');
    expect(draft.groupingKey).toBe('cve:cve-2026-12345');
  });

  it('builds stable grouping keys from unordered entities', () => {
    expect(
      buildEventGroupingKey({
        vendors: ['Microsoft', 'Cisco'],
        products: ['VPN'],
        cves: [],
        attackTypes: ['ransomware', 'active exploitation'],
      })
    ).toBe('cisco|microsoft|vpn::active exploitation|ransomware');
  });
});
