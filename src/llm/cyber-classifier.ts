import { callLLMWithSchema } from '../agents/llmHelpers.js';
import type { ArticleRecord } from '../db/repositories/article.repository.js';
import { CyberClassificationSchema, type CyberClassification } from './schemas.js';

export type SchemaCaller<T> = (systemPrompt: string, userPrompt: string) => Promise<T>;

const systemPrompt = [
  'You classify cyber threat intelligence articles.',
  'Return strict JSON only, with exactly these top-level keys:',
  'cyberRelevant, eventType, severity, urgency, confidence, vendorRoles, affectedProducts, cves, reasoning.',
  'Use severity as one of: low, medium, high, critical.',
  'Use urgency as one of: P1, P2, P3, P4.',
  'Use confidence as a number from 0 to 1, not a string.',
  'vendorRoles must be an array of objects with vendor, role, and rationale.',
  'Each vendor role must be one of: affected, reporting, mitigating, researching, patching, unrelated, unknown.',
  'affectedProducts and cves must always be arrays, even when empty.',
  'Classify vendor roles conservatively and mark mention-only vendors as unrelated or unknown.',
].join(' ');

export async function classifyCyberArticle(
  article: ArticleRecord,
  options: { call?: SchemaCaller<CyberClassification> } = {}
): Promise<CyberClassification> {
  const call =
    options.call ??
    ((system, user) => callLLMWithSchema(system, user, CyberClassificationSchema, { temperature: 0.1 }));

  return call(systemPrompt, JSON.stringify({
    title: article.title,
    sourceName: article.sourceName,
    rssSummary: article.rssSummary,
    cleanText: article.cleanText?.slice(0, 12000),
  }));
}
