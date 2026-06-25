export interface RssFeed {
  url: string;
  source: string;
}

/**
 * Curated cyber threat intelligence feeds. Mix of:
 * - Government advisories (CISA)
 * - Independent security journalism (Krebs, BleepingComputer, The Hacker News)
 * - Vendor advisories can be appended as the inventory grows.
 */
export const rssFeeds: RssFeed[] = [
  { url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml', source: 'CISA' },
  { url: 'https://krebsonsecurity.com/feed/', source: 'Krebs on Security' },
  { url: 'https://www.bleepingcomputer.com/feed/', source: 'Bleeping Computer' },
  { url: 'https://feeds.feedburner.com/TheHackersNews', source: 'The Hacker News' },
];
