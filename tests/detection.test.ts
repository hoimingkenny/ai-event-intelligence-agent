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

  it('caps vendorless CVEs in RSS metadata at maybe keep', () => {
    const decision = decideCheapFilter({
      title: 'CVE-2026-12345 affects enterprise VPN appliance',
      rssSummary: 'Patch guidance is available.',
      sourceName: 'Unknown Blog',
    });

    expect(decision.decision).toBe('MAYBE_KEEP');
    expect(decision.score).toBeGreaterThanOrEqual(40);
    expect(decision.reasons).toContain('cve_found');
    expect(decision.reasons).toContain('cheap_filter_l1_severe_signal_escape_hatch');
    expect(decision.matchedSignals.cves).toEqual(['CVE-2026-12345']);
  });

  it('normalizes cheap-filter scores to a 0-100 range', () => {
    const maxSignalDecision = decideCheapFilter({
      title: 'Microsoft SharePoint CVE-2026-12345 zero-day actively exploited in RCE attacks',
      rssSummary: 'CISA added the known exploited vulnerability after emergency patches for Microsoft SharePoint Server.',
      rssCategories: ['Security Advisory', 'Vulnerability', 'Zero-Day'],
      sourceName: 'CISA',
      publishedAt: new Date(),
    });
    const noisyDecision = decideCheapFilter({
      title: 'Cloudflare announces product launch and market opportunity',
      rssSummary: 'The feature release highlights customer stories and market growth.',
      sourceName: 'General Business News',
    });

    expect(maxSignalDecision.score).toBe(100);
    expect(noisyDecision.score).toBeGreaterThanOrEqual(0);
    expect(noisyDecision.score).toBeLessThanOrEqual(100);
  });

  it('caps vendorless exploitation phrases at maybe keep', () => {
    const decision = decideCheapFilter({
      title: 'Fortinet warns customers of actively exploited FortiOS flaw',
      rssSummary: 'Customers are urged to patch immediately.',
      sourceName: 'Bleeping Computer',
      publishedAt: new Date(),
    });

    expect(decision.decision).toBe('MAYBE_KEEP');
    expect(decision.reasons).toContain('critical_cyber_keyword_found');
    expect(decision.reasons).toContain('cheap_filter_l1_severe_signal_escape_hatch');
    expect(decision.reasons).toContain('security_media_source');
  });

  it('caps vendorless known exploited catalog language from CISA at maybe keep', () => {
    const decision = decideCheapFilter({
      title: 'CISA adds new vulnerability to known exploited catalog',
      rssSummary: null,
      sourceName: 'CISA',
    });

    expect(decision.decision).toBe('MAYBE_KEEP');
    expect(decision.reasons).toContain('government_cert_source');
    expect(decision.reasons).toContain('critical_cyber_keyword_found');
  });

  it('drops vendorless security media plus medium keyword', () => {
    const decision = decideCheapFilter({
      title: 'Critical flaw discovered in enterprise identity platform',
      rssSummary: 'Researchers say attackers may gain unauthorized access.',
      sourceName: 'Bleeping Computer',
      publishedAt: new Date(),
    });

    expect(decision.decision).toBe('DROP');
    expect(decision.shouldExtract).toBe(false);
    expect(decision.reasons).toContain('medium_cyber_keyword_found');
    expect(decision.reasons).toContain('security_media_source');
    expect(decision.blockingReasons).toContain('cheap_filter_no_cve_in_rss_metadata');
    expect(decision.blockingReasons).toContain('cheap_filter_no_vendor_product_in_rss_metadata');
    expect(decision.blockingReasons).toContain('cheap_filter_l1_no_vendor_no_severe_signal');
  });

  it('does not blindly promote monitored vendor business articles', () => {
    const decision = decideCheapFilter({
      title: 'Microsoft announces new feature release for enterprise customers',
      rssSummary: 'The product launch includes new dashboard tools.',
      sourceName: 'General Business News',
    });

    expect(decision.decision).toBe('DROP');
    expect(decision.reasons).toContain('monitored_vendor_found');
    expect(decision.blockingReasons).toContain('cheap_filter_l2_negative_dominance');
    expect(decision.blockingReasons).toContain('cheap_filter_negative_business_context');
  });

  it('lets quiet monitored vendors pass medium keyword coverage as low priority', () => {
    const decision = decideCheapFilter({
      title: 'CyberArk publishes vulnerability guidance',
      rssSummary: 'Customers should review privileged access controls.',
      sourceName: 'Unknown Source',
    });

    expect(decision.decision).toBe('MAYBE_KEEP');
    expect(decision.score).toBeGreaterThanOrEqual(35);
    expect(decision.reasons).toContain('monitored_vendor_found');
    expect(decision.reasons).toContain('medium_cyber_keyword_found');
  });

  it('does not let RSS security categories bypass the vendor gate', () => {
    const decision = decideCheapFilter({
      title: 'Enterprise platform update released',
      rssSummary: 'A maintenance update is available.',
      sourceName: 'Unknown Blog',
      rssCategories: ['Vulnerabilities'],
    });

    expect(decision.decision).toBe('DROP');
    expect(decision.reasons).toContain('security_rss_category_found');
    expect(decision.blockingReasons).toContain('cheap_filter_l1_no_vendor_no_severe_signal');
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

  it('keeps noisy-vendor medium coverage as low priority when corroborated', () => {
    const decision = decideCheapFilter({
      title: 'Microsoft Patch Tuesday fixes 120 security vulnerabilities',
      rssSummary: 'Several flaws received critical severity ratings.',
      sourceName: 'The Hacker News',
    });

    expect(decision.decision).toBe('MAYBE_KEEP');
    expect(decision.reasons).toContain('monitored_vendor_found');
    expect(decision.reasons).toContain('medium_cyber_keyword_found');
  });

  it('implements the cascade routing table and invariants', () => {
    const zscalerLaunch = decideCheapFilter({
      title: 'Zscaler announces product launch',
      rssSummary: 'The new feature release is available for customers.',
      sourceName: 'General Business News',
    });
    const ransomwareNoVendor = decideCheapFilter({
      title: 'Hospital hit by ransomware',
      rssSummary: 'The incident disrupted patient services.',
      sourceName: 'Bleeping Computer',
    });
    const vendorlessZeroDay = decideCheapFilter({
      title: 'Zero-day in popular PAM solution under active attack',
      rssSummary: 'Researchers warn administrators to apply mitigations.',
      sourceName: 'Research Blog',
    });
    const cyberarkExploit = decideCheapFilter({
      title: 'CyberArk PAS authentication bypass exploited in attacks',
      rssSummary: 'The remote code execution chain affects privileged access deployments.',
      sourceName: 'Bleeping Computer',
    });

    expect(zscalerLaunch.decision).toBe('DROP');
    expect(zscalerLaunch.blockingReasons).toContain('cheap_filter_l2_negative_dominance');
    expect(ransomwareNoVendor.decision).toBe('DROP');
    expect(ransomwareNoVendor.blockingReasons).toContain('cheap_filter_l1_no_vendor_no_severe_signal');
    expect(vendorlessZeroDay.decision).toBe('MAYBE_KEEP');
    expect(vendorlessZeroDay.score).toBeLessThan(50);
    expect(cyberarkExploit.decision).toBe('KEEP');
    expect(cyberarkExploit.blockingReasons).not.toContain('cheap_filter_l1_no_vendor_no_severe_signal');
    expect(cyberarkExploit.blockingReasons).not.toContain('cheap_filter_l2_no_cyber_context');
  });
});
