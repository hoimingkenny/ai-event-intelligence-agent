import { describe, expect, it } from 'vitest';
import {
  buildZonedText,
  contradictedVendors,
  crossCheckVendorConfidence,
  locatePhrase,
  scoreEntity,
} from '../src/detection/entity-confidence.js';
import { extractArticleEntities } from '../src/detection/entity-extractor.js';

describe('scoreEntity', () => {
  it('scores a corroborated vendor in the title high', () => {
    expect(scoreEntity({ entityType: 'vendor', zones: ['title'], occurrences: 1, corroborated: true }))
      .toBeGreaterThanOrEqual(0.9);
  });

  it('caps an uncorroborated vendor (no CVE/keywords nearby) as likely noise', () => {
    const score = scoreEntity({ entityType: 'vendor', zones: ['body'], occurrences: 1, corroborated: false });
    expect(score).toBeLessThanOrEqual(0.45);
  });

  it('scores a vendor only found in the tail low even when corroborated', () => {
    const tail = scoreEntity({ entityType: 'vendor', zones: ['tail'], occurrences: 1, corroborated: true });
    const title = scoreEntity({ entityType: 'vendor', zones: ['title'], occurrences: 1, corroborated: true });
    expect(tail).toBeLessThan(title);
  });

  it('rewards repeated mentions', () => {
    const once = scoreEntity({ entityType: 'vendor', zones: ['body'], occurrences: 1, corroborated: true });
    const twice = scoreEntity({ entityType: 'vendor', zones: ['body'], occurrences: 2, corroborated: true });
    expect(twice).toBeGreaterThan(once);
  });

  it('scores structural CVE/IOC high regardless of corroboration', () => {
    expect(scoreEntity({ entityType: 'cve', zones: ['body'], occurrences: 1, corroborated: false }))
      .toBeGreaterThanOrEqual(0.9);
  });

  it('down-scores a CVE that only appears in the tail', () => {
    expect(scoreEntity({ entityType: 'cve', zones: ['tail'], occurrences: 1, corroborated: false }))
      .toBeLessThan(0.9);
  });
});

describe('buildZonedText + locatePhrase', () => {
  it('splits body into lead/body/tail and locates a phrase by zone', () => {
    const body = `${'lead text '.repeat(60)}${'middle '.repeat(60)}Fortinet appears only at the very end.`;
    const zones = buildZonedText({ title: 'Cisco advisory', body });

    expect(locatePhrase(zones, 'Cisco').zones).toContain('title');
    expect(locatePhrase(zones, 'Fortinet').zones).toContain('tail');
  });
});

describe('crossCheckVendorConfidence', () => {
  it('down-weights a vendor the LLM calls unrelated', () => {
    const adjusted = crossCheckVendorConfidence('Microsoft', 0.8, [
      { vendor: 'Microsoft', role: 'unrelated' },
    ]);
    expect(adjusted).toBeCloseTo(0.32, 2);
  });

  it('boosts a vendor the LLM affirms as affected', () => {
    const adjusted = crossCheckVendorConfidence('Cisco', 0.6, [{ vendor: 'Cisco', role: 'affected' }]);
    expect(adjusted).toBeCloseTo(0.8, 2);
  });

  it('leaves confidence unchanged when the LLM has no opinion', () => {
    expect(crossCheckVendorConfidence('Zscaler', 0.7, [])).toBeCloseTo(0.7, 5);
  });
});

describe('contradictedVendors', () => {
  it('lists deterministic vendors the LLM judged unrelated', () => {
    const contradicted = contradictedVendors(['Microsoft', 'Cisco'], [
      { vendor: 'Microsoft', role: 'unrelated' },
      { vendor: 'Cisco', role: 'affected' },
    ]);
    expect(contradicted).toEqual(['Microsoft']);
  });
});

describe('extractArticleEntities (zoned, end-to-end)', () => {
  it('gives a title vendor with security context high confidence, a footer vendor low', () => {
    const entities = extractArticleEntities('a1', {
      title: 'CyberArk exploited via CVE-2026-21001',
      body:
        'Attackers are exploiting a critical vulnerability in CyberArk. '.repeat(20) +
        'Related: Zscaler announces new feature.',
    });

    const cyberark = entities.find((e) => e.entityValue === 'CyberArk');
    const zscaler = entities.find((e) => e.entityValue === 'Zscaler');

    expect(cyberark?.confidence ?? 0).toBeGreaterThanOrEqual(0.9);
    // Zscaler only appears once in the tail — should be gated out downstream.
    expect(zscaler?.confidence ?? 1).toBeLessThan(0.5);
  });
});
