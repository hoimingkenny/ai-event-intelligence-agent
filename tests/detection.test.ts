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
      sourceName: 'General Business News',
    });

    expect(decision.decision).toBe('DROP');
    expect(decision.shouldExtract).toBe(false);
    expect(decision.blockingReasons).toContain('cheap_filter_insufficient_rss_signal');
    expect(decision.blockingReasons).toContain('cheap_filter_negative_business_context');
  });

  it('advances articles with vendor and vulnerability signal', () => {
    const decision = decideCheapFilter({
      title: 'Zscaler Internet Access vulnerability patched',
      rssSummary: 'The advisory describes privilege escalation in ZIA.',
      sourceName: 'Bleeping Computer',
    });

    expect(decision.decision).toBe('KEEP');
    expect(decision.shouldExtract).toBe(true);
    expect(decision.vendors).toContain('Zscaler');
    expect(decision.products).toContain('Zscaler Internet Access');
  });

  it('keeps articles with CVEs in RSS metadata', () => {
    const decision = decideCheapFilter({
      title: 'CVE-2026-12345 affects enterprise VPN appliance',
      rssSummary: 'Patch guidance is available.',
      sourceName: 'Unknown Blog',
    });

    expect(decision.decision).toBe('KEEP');
    expect(decision.score).toBeGreaterThanOrEqual(40);
    expect(decision.reasons).toContain('cve_found');
    expect(decision.matchedSignals.cves).toEqual(['CVE-2026-12345']);
  });

  it('keeps critical exploitation phrases', () => {
    const decision = decideCheapFilter({
      title: 'Fortinet warns customers of actively exploited FortiOS flaw',
      rssSummary: 'Customers are urged to patch immediately.',
      sourceName: 'Bleeping Computer',
      publishedAt: new Date(),
    });

    expect(decision.decision).toBe('KEEP');
    expect(decision.reasons).toContain('critical_cyber_keyword_found');
    expect(decision.reasons).toContain('security_media_source');
  });

  it('keeps known exploited catalog language from CISA', () => {
    const decision = decideCheapFilter({
      title: 'CISA adds new vulnerability to known exploited catalog',
      rssSummary: null,
      sourceName: 'CISA',
    });

    expect(decision.decision).toBe('KEEP');
    expect(decision.reasons).toContain('government_cert_source');
    expect(decision.reasons).toContain('critical_cyber_keyword_found');
  });

  it('treats security media plus medium keyword as maybe keep', () => {
    const decision = decideCheapFilter({
      title: 'Critical flaw discovered in enterprise identity platform',
      rssSummary: 'Researchers say attackers may gain unauthorized access.',
      sourceName: 'Bleeping Computer',
      publishedAt: new Date(),
    });

    expect(decision.decision).toBe('MAYBE_KEEP');
    expect(decision.shouldExtract).toBe(true);
    expect(decision.reasons).toContain('medium_cyber_keyword_found');
    expect(decision.reasons).toContain('security_media_source');
    expect(decision.blockingReasons).toContain('cheap_filter_no_cve_in_rss_metadata');
    expect(decision.blockingReasons).toContain('cheap_filter_no_vendor_product_in_rss_metadata');
  });

  it('does not blindly promote monitored vendor business articles', () => {
    const decision = decideCheapFilter({
      title: 'Microsoft announces new feature release for enterprise customers',
      rssSummary: 'The product launch includes new dashboard tools.',
      sourceName: 'General Business News',
    });

    expect(decision.decision).toBe('DROP');
    expect(decision.reasons).toContain('monitored_vendor_found');
    expect(decision.blockingReasons).toContain('cheap_filter_vendor_only_without_security_context');
    expect(decision.blockingReasons).toContain('cheap_filter_negative_business_context');
  });

  it('weights monitored vendor mentions as a strong cheap-filter signal', () => {
    const decision = decideCheapFilter({
      title: 'CyberArk publishes customer guidance',
      rssSummary: 'Customers should review privileged access controls.',
      sourceName: 'Unknown Source',
    });

    expect(decision.decision).toBe('MAYBE_KEEP');
    expect(decision.score).toBeGreaterThanOrEqual(55);
    expect(decision.reasons).toContain('monitored_vendor_found');
  });

  it('uses RSS security categories as weak extraction signal', () => {
    const decision = decideCheapFilter({
      title: 'Enterprise platform update released',
      rssSummary: 'A maintenance update is available.',
      sourceName: 'Unknown Blog',
      rssCategories: ['Vulnerabilities'],
    });

    expect(decision.decision).toBe('MAYBE_KEEP');
    expect(decision.reasons).toContain('security_rss_category_found');
  });

  it('drops noisy business uses of exploit and breach', () => {
    const exploitDecision = decideCheapFilter({
      title: 'Companies exploit AI market opportunity',
      rssSummary: 'Analysts discuss market growth.',
      sourceName: 'General Business News',
    });
    const breachDecision = decideCheapFilter({
      title: 'Vendor accused of breach of contract',
      rssSummary: 'The dispute concerns a partnership agreement.',
      sourceName: 'General Business News',
    });

    expect(exploitDecision.decision).toBe('DROP');
    expect(breachDecision.decision).toBe('DROP');
  });

  it('keeps Patch Tuesday security vulnerability coverage', () => {
    const decision = decideCheapFilter({
      title: 'Microsoft Patch Tuesday fixes 120 security vulnerabilities',
      rssSummary: 'Several flaws received critical severity ratings.',
      sourceName: 'The Hacker News',
    });

    expect(decision.decision).toBe('KEEP');
    expect(decision.reasons).toContain('monitored_vendor_found');
    expect(decision.reasons).toContain('medium_cyber_keyword_found');
  });
});
