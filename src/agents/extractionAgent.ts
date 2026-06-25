import { z } from 'zod';
import type { ExtractedCyberFacts, RawArticle } from '../types/domain.js';
import { monitoredVendors } from '../storage/vendorInventory.js';
import { callLLMWithSchema } from './llmHelpers.js';

const factsSchema = z.object({
  eventType: z.enum([
    'active_exploitation',
    'cyber_attack',
    'ransomware',
    'data_breach',
    'zero_day',
    'vendor_advisory',
    'critical_vulnerability',
    'exploit_release',
    'patch_or_mitigation',
    'irrelevant',
  ]),
  vendors: z.array(z.string()),
  products: z.array(z.string()),
  cveIds: z.array(z.string().regex(/^CVE-\d{4}-\d{4,7}$/i)),
  threatActors: z.array(z.string()),
  victimOrganizations: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
  summary: z.string(),
  evidence: z.array(z.string()),
});

function deterministicExtract(article: RawArticle): ExtractedCyberFacts {
  const text = `${article.title} ${article.snippet ?? ''}`.toLowerCase();
  const matched = monitoredVendors.filter((item) => {
    const tokens = [item.vendor, item.product, ...item.aliases].map((x) => x.toLowerCase());
    return tokens.some((token) => text.includes(token));
  });

  const cves = Array.from(text.matchAll(/cve-\d{4}-\d{4,7}/gi)).map((m) => m[0].toUpperCase());

  let eventType: ExtractedCyberFacts['eventType'] = 'irrelevant';
  if (/actively exploited|active exploitation|exploited in the wild/.test(text)) eventType = 'active_exploitation';
  else if (/ransomware/.test(text)) eventType = 'ransomware';
  else if (/breach|data leak|exposed/.test(text)) eventType = 'data_breach';
  else if (/zero.?day|0.?day/.test(text)) eventType = 'zero_day';
  else if (/advisory|patch|mitigation/.test(text)) eventType = 'vendor_advisory';
  else if (/vulnerability|cve/.test(text)) eventType = 'critical_vulnerability';
  else if (/attack|incident/.test(text)) eventType = 'cyber_attack';

  return {
    articleId: article.id,
    eventType,
    vendors: matched.map((m) => m.vendor),
    products: matched.map((m) => m.product),
    cveIds: cves,
    threatActors: [],
    victimOrganizations: [],
    confidence: matched.length > 0 && eventType !== 'irrelevant' ? 'medium' : 'low',
    summary: article.snippet ?? article.title,
    evidence: [article.title, article.snippet ?? ''].filter(Boolean),
  };
}

export async function extractCyberFacts(article: RawArticle): Promise<ExtractedCyberFacts> {
  const vendorList = monitoredVendors
    .map((v) => `${v.vendor} / ${v.product}${v.aliases.length ? ` (aliases: ${v.aliases.join(', ')})` : ''}`)
    .join('\n');

  const systemPrompt = `You are a cyber-threat-intelligence extractor. Read a news article and return JSON matching the requested schema. Only extract entities you can verify from the text. If a vendor or product is not on the monitored list, omit it.`;
  const userPrompt = `Monitored vendors/products:\n${vendorList}\n\nArticle title: ${article.title}\nURL: ${article.url}\nSnippet: ${article.snippet ?? '(none)'}\n\nExtract cyber facts. Return JSON with fields: eventType, vendors, products, cveIds, threatActors, victimOrganizations, confidence, summary, evidence.`;

  try {
    const parsed = await callLLMWithSchema(systemPrompt, userPrompt, factsSchema);
    return { articleId: article.id, ...parsed };
  } catch (err) {
    // Fallback so the pipeline still produces output when MiniMax is unavailable.
    return deterministicExtract(article);
  }
}
