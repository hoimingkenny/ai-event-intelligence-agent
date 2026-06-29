import { callLLMWithSchema } from '../agents/llmHelpers.js';
import type { ArticleRecord } from '../db/repositories/article.repository.js';
import { CyberClassificationSchema, type CyberClassification } from './schemas.js';

export type SchemaCaller<T> = (systemPrompt: string, userPrompt: string) => Promise<T>;

const systemPrompt = [
  'You classify cyber threat intelligence articles.',
  'Return strict JSON only.',
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
