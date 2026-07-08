import { callLLMWithSchema } from '../agents/llmHelpers.js';
import type { ArticleRecord } from '../db/repositories/article.repository.js';
import type { EventRecord } from '../db/repositories/event.repository.js';
import { EventSummarySchema, type EventSummary } from './schemas.js';
import type { SchemaCaller } from './cyber-classifier.js';

const systemPrompt = [
  'You summarize cyber events for vendor risk analysts.',
  'The output is the standalone alert/channel payload humans will read first.',
  'Write titles in present tense, 96 characters or fewer, with the affected issue first.',
  'Do not prefix titles with only the vendor/product name, and do not end with filler like report, advisory, update, or alert.',
  'If evidence is thin, low-confidence, or early-warning only, explicitly label that uncertainty in the summary.',
  'Return strict JSON only.',
  'Keep summaries concise, factual, and tied to the supplied source articles.',
].join(' ');

export async function summarizeEvent(
  event: EventRecord,
  articles: ArticleRecord[],
  options: { call?: SchemaCaller<EventSummary> } = {}
): Promise<EventSummary> {
  const call =
    options.call ??
    ((system, user) => callLLMWithSchema(system, user, EventSummarySchema, { temperature: 0.2 }));

  return call(systemPrompt, JSON.stringify({
    event,
    articles: articles.map((article) => ({
      title: article.title,
      sourceName: article.sourceName,
      rssSummary: article.rssSummary,
      cleanText: article.cleanText?.slice(0, 5000),
    })),
  }));
}
