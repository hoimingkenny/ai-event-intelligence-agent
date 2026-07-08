import { describe, expect, it } from 'vitest';
import {
  CyberClassificationSchema,
  EventComparisonSchema,
  EventSummarySchema,
} from '../src/llm/schemas.js';

describe('LLM schemas', () => {
  it('validates cyber classification output', () => {
    const parsed = CyberClassificationSchema.parse({
      cyberRelevant: true,
      eventType: 'active_exploitation',
      severity: 'critical',
      urgency: 'P1',
      confidence: 0.92,
      vendorRoles: [{ vendor: 'Vendor', role: 'affected', rationale: 'Product is exploited.' }],
      affectedProducts: ['VPN'],
      cves: ['CVE-2026-1234'],
      reasoning: 'Article describes active exploitation.',
    });

    expect(parsed.vendorRoles[0].role).toBe('affected');
  });

  it('rejects invalid event comparison relationships', () => {
    expect(() =>
      EventComparisonSchema.parse({
        relationship: 'maybe_same',
        confidence: 0.8,
        isMaterialUpdate: false,
        rationale: 'unclear',
      })
    ).toThrow();
  });

  it('validates event summaries', () => {
    const parsed = EventSummarySchema.parse({
      title: 'Vendor VPN active exploitation',
      summary: 'Attackers are exploiting a Vendor VPN vulnerability.',
      severity: 'high',
      urgency: 'P2',
      confidence: 0.86,
      keyFacts: ['CVE-2026-1234 is referenced.'],
      recommendedActions: ['Review exposure and apply vendor guidance.'],
    });

    expect(parsed.keyFacts).toHaveLength(1);
  });

  it('rejects event summary titles that are too long for the portal list', () => {
    expect(() =>
      EventSummarySchema.parse({
        title: 'A'.repeat(97),
        summary: 'Attackers are exploiting a Vendor VPN vulnerability.',
        severity: 'high',
        urgency: 'P2',
        confidence: 0.86,
        keyFacts: [],
        recommendedActions: [],
      })
    ).toThrow();
  });
});
