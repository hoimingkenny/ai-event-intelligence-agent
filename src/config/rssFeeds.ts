export interface RssFeed {
  url: string;
  source: string;
  isActive?: boolean;
}

/**
 * Curated feeds for the 3-product POC scope (CyberArk PAS, Zscaler ZIA,
 * Microsoft Windows Server/Exchange/Entra). Deliberately mixes source tiers so
 * the cheap filter's tier boosts are exercised end to end:
 * - government_cert: CISA
 * - official_vendor: MSRC Security Update Guide
 * - researcher_blog: CyberArk Blog (vendor blog; tier inferred from name)
 * - security_media: Krebs, BleepingComputer, The Hacker News
 *
 * Zscaler's trust portal has no public RSS (JS-rendered); ZIA coverage comes
 * from CISA + security media until a scraper source is added.
 */
export const rssFeeds: RssFeed[] = [
  { url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml', source: 'CISA' },
  { url: 'https://api.msrc.microsoft.com/update-guide/rss', source: 'Microsoft Security Advisories (MSRC)', isActive: false },
  { url: 'https://www.cyberark.com/feed/', source: 'CyberArk Blog' },
  { url: 'https://krebsonsecurity.com/feed/', source: 'Krebs on Security' },
  { url: 'https://www.bleepingcomputer.com/feed/', source: 'Bleeping Computer' },
  { url: 'https://feeds.feedburner.com/TheHackersNews', source: 'The Hacker News' },
];
