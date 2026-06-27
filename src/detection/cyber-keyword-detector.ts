export const CYBER_KEYWORDS = [
  '0-day',
  'active exploitation',
  'authentication bypass',
  'backdoor',
  'breach',
  'compromise',
  'credential theft',
  'cve',
  'data leak',
  'emergency update',
  'exploit',
  'exploited',
  'incident',
  'malware',
  'patch',
  'privilege escalation',
  'ransomware',
  'remote code execution',
  'rce',
  'supply chain',
  'vulnerability',
  'zero-day',
];

export interface KeywordDetectionResult {
  isCyberRelevant: boolean;
  matchedKeywords: string[];
}

export function detectCyberKeywords(text: string): KeywordDetectionResult {
  const normalized = text.toLowerCase();
  const matchedKeywords = CYBER_KEYWORDS.filter((keyword) =>
    normalized.includes(keyword.toLowerCase())
  );

  return {
    isCyberRelevant: matchedKeywords.length > 0,
    matchedKeywords,
  };
}
