import { callLLMWithSchema } from '../agents/llmHelpers.js';
import type { ArticleRecord } from '../db/repositories/article.repository.js';
import type { EventRecord } from '../db/repositories/event.repository.js';
import { EventComparisonSchema, type EventComparison } from './schemas.js';
import type { SchemaCaller } from './cyber-classifier.js';

const systemPrompt = [
  'You compare whether a new article belongs to an existing cyber event.',
  'Return strict JSON only.',
  'Use same_event only when the exploit, vendor/product, CVE, or victim context clearly matches.',
].join(' ');

export async function compareArticleToEvent(
  article: ArticleRecord,
  event: EventRecord,
  options: { call?: SchemaCaller<EventComparison> } = {}
): Promise<EventComparison> {
  const call =
    options.call ??
    ((system, user) => callLLMWithSchema(system, user, EventComparisonSchema, { temperature: 0.1 }));

  return call(systemPrompt, JSON.stringify({
    article: {
      title: article.title,
      sourceName: article.sourceName,
      rssSummary: article.rssSummary,
      cleanText: article.cleanText?.slice(0, 8000),
    },
    event,
  }));
}
