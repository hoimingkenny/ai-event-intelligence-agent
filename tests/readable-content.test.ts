import { describe, expect, it } from 'vitest';
import {
  extractReadableContent,
  filterBoilerplateLines,
  sourceSelectorForUrl,
} from '../src/extraction/readable-content.js';

const paragraph =
  'Attackers are actively exploiting a critical vulnerability in the product, allowing remote code execution on unpatched systems. '.repeat(
    3
  );

function articlePage(bodySelectorClass = 'articleBody'): string {
  return `
    <html><head><title>CVE report</title></head><body>
      <nav><a href="/">Home</a><a href="/news">News</a></nav>
      <div class="${bodySelectorClass}">
        <h1>Critical vulnerability exploited in the wild</h1>
        <p>${paragraph}</p>
        <p>Vendors urged administrators to apply patches immediately, according to the advisory.</p>
        <div class="related-articles"><a href="/a">Microsoft patches Exchange zero-day</a></div>
      </div>
      <div class="newsletter"><p>Subscribe to our newsletter for the latest security news and updates delivered daily!</p></div>
      <footer><p>© 2026 Example Media. All rights reserved.</p></footer>
    </body></html>
  `;
}

describe('extractReadableContent', () => {
  it('uses per-source selector and strips nav, footer, related links', () => {
    const result = extractReadableContent(
      articlePage(),
      'https://www.bleepingcomputer.com/news/security/some-article/'
    );

    expect(result.method).toBe('source_selector');
    expect(result.cleanText).toContain('actively exploiting a critical vulnerability');
    expect(result.cleanText).not.toContain('Subscribe to our newsletter');
    expect(result.cleanText).not.toContain('All rights reserved');
    expect(result.cleanText).not.toContain('Microsoft patches Exchange zero-day');
  });

  it('falls back to Readability for unknown domains and still drops boilerplate', () => {
    const result = extractReadableContent(articlePage('post-content'), 'https://unknown.example/a');

    expect(result.method).toBe('readability');
    expect(result.cleanText).toContain('actively exploiting a critical vulnerability');
    expect(result.cleanText).not.toContain('Subscribe to our newsletter');
  });

  it('drops high-link-density blocks (related-article lists)', () => {
    const html = `
      <html><body><div class="entry-content">
        <p>${paragraph}</p>
        <ul>
          <li><a href="/1">Ransomware gang hits hospital</a></li>
          <li><a href="/2">New phishing kit targets banks</a></li>
        </ul>
      </div></body></html>
    `;
    const result = extractReadableContent(html, 'https://krebsonsecurity.com/2026/07/x/');

    expect(result.cleanText).toContain('actively exploiting');
    expect(result.cleanText).not.toContain('Ransomware gang hits hospital');
  });

  it('removes BleepingComputer-style native ad clusters (repeated offsite CTA link)', () => {
    const adUrl = 'https://hubs.li/Q04jQ9z40';
    const html = `
      <html><head><title>t</title></head><body><div class="articleBody">
        <p>${paragraph}</p>
        <h2>Flagged as exploited by ransomware gangs</h2>
        <p>CISA added the flaw to its Known Exploited Vulnerabilities catalog, ordering agencies to patch their devices within two weeks.</p>
        <p><a href="${adUrl}"><img src="https://cdn.example/banner.jpg"></a></p>
        <h2><a href="${adUrl}">Test every layer before attackers do</a></h2>
        <p>Security teams log 54% of successful attacks and alert on just 14%. The rest move through your environment unseen.</p>
        <p>The Picus whitepaper shows how breach and attack simulation tests your SIEM and EDR rules so threats stop slipping by detection.</p>
        <p><a href="${adUrl}">Get the whitepaper</a></p>
        <p>While Microsoft has yet to tag this security flaw as exploited in attacks, CISA has now flagged it as exploited in ransomware campaigns.</p>
      </div></body></html>
    `;
    const result = extractReadableContent(html, 'https://www.bleepingcomputer.com/news/security/x/');

    expect(result.cleanText).toContain('Flagged as exploited by ransomware gangs');
    expect(result.cleanText).toContain('flagged it as exploited in ransomware campaigns');
    expect(result.cleanText).not.toContain('Test every layer before attackers do');
    expect(result.cleanText).not.toContain('Security teams log 54%');
    expect(result.cleanText).not.toContain('The Picus whitepaper');
    expect(result.cleanText).not.toContain('Get the whitepaper');
  });

  it('removes standalone offsite image banners but keeps plain screenshots', () => {
    const html = `
      <html><head><title>t</title></head><body><div class="articleBody">
        <p>${paragraph}</p>
        <p><a href="https://www.tines.com/access/guide/?utm_source=BleepingComputer"><img src="https://cdn.example/ti-97.jpg"></a></p>
        <p><img src="https://www.bleepstatic.com/images/news/demo.jpg" alt="Exploit demo"></p>
        <p>Attackers can escalate to SYSTEM privileges and take control of the targeted system, researchers said.</p>
      </div></body></html>
    `;
    const result = extractReadableContent(html, 'https://www.bleepingcomputer.com/news/security/x/');

    expect(result.cleanText).toContain('escalate to SYSTEM privileges');
    expect(result.cleanText).not.toContain('tines');
  });

  it('does not remove real content that cites the same external source twice', () => {
    const html = `
      <html><head><title>t</title></head><body><div class="articleBody">
        <p>${paragraph}</p>
        <p>The advisory published at <a href="https://nvd.nist.gov/vuln/detail/CVE-2026-1234">NVD</a> rates the flaw as critical with a CVSS score of 9.8, and administrators are urged to patch immediately.</p>
        <p>Details in the <a href="https://nvd.nist.gov/vuln/detail/CVE-2026-1234">NVD entry</a> confirm the vulnerability affects all versions prior to 2.4, and exploitation requires no authentication or user interaction whatsoever, making internet-exposed appliances especially easy targets for opportunistic attackers. Researchers separately observed mass scanning activity beginning within hours of publication, with honeypots recording thousands of exploitation attempts from hundreds of unique IP addresses across multiple countries. Security teams are strongly advised to prioritize patching internet-facing systems first, review appliance logs going back at least two weeks for indicators of compromise, rotate any credentials stored on affected devices, and monitor vendor channels for updated guidance as the investigation into the full scope of exploitation continues.</p>
      </div></body></html>
    `;
    const result = extractReadableContent(html, 'https://www.bleepingcomputer.com/news/security/x/');

    expect(result.cleanText).toContain('CVSS score of 9.8');
    expect(result.cleanText).toContain('mass scanning activity');
  });

  it('returns null cleanText when there is no content', () => {
    const result = extractReadableContent('<html><body></body></html>', 'https://x.example');
    expect(result.cleanText).toBeNull();
    expect(result.method).toBe('none');
  });
});

describe('sourceSelectorForUrl', () => {
  it('matches known domains including subdomains and www', () => {
    expect(sourceSelectorForUrl('https://www.bleepingcomputer.com/news/x')).toBe('div.articleBody');
    expect(sourceSelectorForUrl('https://thehackernews.com/2026/07/x.html')).toBe('div#articlebody');
    expect(sourceSelectorForUrl('https://unknown.example/x')).toBeNull();
    expect(sourceSelectorForUrl('not a url')).toBeNull();
  });
});

describe('filterBoilerplateLines', () => {
  it('drops junk lines and keeps substantive ones', () => {
    const kept = filterBoilerplateLines([
      'Subscribe to our newsletter',
      'Related Articles',
      'Share this post',
      'Tags: security, malware',
      'The vulnerability affects all versions prior to 2.4 and is tracked as CVE-2026-1234.',
    ]);

    expect(kept).toEqual([
      'The vulnerability affects all versions prior to 2.4 and is tracked as CVE-2026-1234.',
    ]);
  });
});
