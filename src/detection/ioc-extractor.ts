const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const DOMAIN_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;
const HASH_PATTERN = /\b(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})\b/gi;

export interface ExtractedIocs {
  ips: string[];
  domains: string[];
  hashes: string[];
}

export function extractIocs(text: string): ExtractedIocs {
  return {
    ips: unique(text.match(IPV4_PATTERN) ?? []),
    domains: unique((text.match(DOMAIN_PATTERN) ?? []).map((domain) => domain.toLowerCase())),
    hashes: unique((text.match(HASH_PATTERN) ?? []).map((hash) => hash.toLowerCase())),
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
