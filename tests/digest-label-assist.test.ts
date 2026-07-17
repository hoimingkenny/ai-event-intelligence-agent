import { describe, expect, it } from 'vitest';
import {
  draftDigestGoldFromStoredDigest,
  proposeDigestGoldAssist,
} from '../src/evaluation/digest/digest-label-assist.js';

describe('draftDigestGoldFromStoredDigest', () => {
  it('maps stored digest fields to gold draft', () => {
    const draft = draftDigestGoldFromStoredDigest({
      relatedToMonitoredInventory: true,
      incidentSummary: 'Advisory',
      cves: ['CVE-2024-9999'],
      matchedVendors: ['CyberArk'],
      matchedProducts: ['PAS'],
      mentionedVendors: [],
      mentionedProducts: [],
      affectedOrganizations: [],
      confidence: 0.8,
      reasoning: 'because',
    });

    expect(draft).toEqual({
      relatedToMonitoredInventory: true,
      matchedVendors: ['CyberArk'],
      matchedProducts: ['PAS'],
      cves: ['CVE-2024-9999'],
      humanReason: null,
    });
  });

  it('returns null for invalid stored digest', () => {
    expect(draftDigestGoldFromStoredDigest({ bad: true })).toBeNull();
  });
});

describe('proposeDigestGoldAssist', () => {
  it('returns injectable assist draft without writing gold', async () => {
    const draft = await proposeDigestGoldAssist(
      {
        article: {
          title: 'Test',
          sourceName: 'Source',
          rssSummary: 'rss',
          cleanText: 'body',
        },
        inventory: [
          {
            id: 'vp_cyberark_pas',
            vendor: 'CyberArk',
            product: 'PAS',
            criticality: 'critical',
            inProduction: true,
            newsVolume: 'quiet',
            aliases: [],
          },
        ],
      },
      {
        call: async () => ({
          relatedToMonitoredInventory: true,
          matchedVendors: ['CyberArk'],
          matchedProducts: ['PAS'],
          cves: ['CVE-2024-0001'],
          reasoning: 'Draft only',
        }),
      }
    );

    expect(draft.matchedProducts).toEqual(['PAS']);
    expect(draft.reasoning).toBe('Draft only');
  });
});
