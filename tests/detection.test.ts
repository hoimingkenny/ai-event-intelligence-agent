import { describe, expect, it } from 'vitest';
import { decideCheapFilter } from '../src/pipeline/filter-stage.js';
import { detectCyberKeywords } from '../src/detection/cyber-keyword-detector.js';
import { extractCves } from '../src/detection/cve-extractor.js';
import { detectVendorsFromInventory } from '../src/detection/vendor-detector.js';
import { monitoredVendors } from '../src/storage/vendorInventory.js';

describe('cheap detection', () => {
  it('detects cyber keywords and CVEs', () => {
    const text = 'CyberArk PAM zero-day CVE-2026-12345 is under active exploitation.';

    expect(detectCyberKeywords(text).matchedKeywords).toContain('active exploitation');
    expect(extractCves(text)).toEqual(['CVE-2026-12345']);
  });

  it('matches vendor and product aliases with word boundaries', () => {
    const result = detectVendorsFromInventory(
      'A critical issue affects CyberArk PAM deployments.',
      monitoredVendors
    );

    expect(result.vendors).toContain('CyberArk');
    expect(result.products).toContain('Privileged Access Security');
  });

  it('does not alert on unrelated prose without cyber or vendor signal', () => {
    const decision = decideCheapFilter({
      title: 'Quarterly product launch newsletter',
      rssSummary: 'New collaboration features are available this month.',
    });

    expect(decision.shouldExtract).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it('advances articles with vendor and vulnerability signal', () => {
    const decision = decideCheapFilter({
      title: 'SailPoint IdentityIQ vulnerability patched',
      rssSummary: 'The advisory describes privilege escalation in IdentityIQ.',
    });

    expect(decision.shouldExtract).toBe(true);
    expect(decision.vendors).toContain('SailPoint');
    expect(decision.products).toContain('IdentityIQ');
  });
});
