/**
 * Gold incident assist — eval-only LLM draft.
 *
 * Given 2–5 articles with extracted bodies, returns per-article briefs plus a
 * draft same-event recommendation and a suggested gold-incident name. The
 * human Accepts (or ignores) the draft; this module never writes gold.
 *
 * ADR-0002: must not reuse the production event comparator.
 */

import { z } from 'zod';
import { callLLMWithSchema } from '../../src/agents/llmHelpers.js';
import {
  GoldIncidentAssistLlmSchema,
  GoldIncidentAssistSchema,
  type GoldIncidentAssist,
  type GoldIncidentAssistLlm,
} from '../../src/llm/schemas.js';
import type { SchemaCaller } from '../../src/llm/cyber-classifier.js';

export const MIN_ASSIST_ARTICLES = 2;
export const MAX_ASSIST_ARTICLES = 5;
export const ASSIST_CLEAN_TEXT_SLICE = 8000;

export interface AssistArticleInput {
  articleId: string;
  url: string;
  title: string;
  sourceName: string;
  cleanText: string;
}

export class AssistInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AssistInputError';
    this.code = code;
  }
}

const systemPrompt = [
  'You help a human build a "gold incident" for a grouping-pair evaluation dataset.',
  'A gold incident is a curated set of 2–5 articles that describe ONE real-world cyber incident,',
  'not an ongoing campaign, threat actor, or multi-week storyline.',
  'Return strict JSON only.',
  'Read each article body carefully. Return exactly one `briefs` entry per input articleId (no extra ids).',
  'For each entry produce 3–6 short bullets in `brief`.',
  'Then decide whether the selected articles describe the same real-world incident:',
  '  same_event — exploit, vendor/product, CVE, victim, or operation context clearly aligns.',
  '  mixed — only a subset aligns; another article is a different incident or an unrelated follow-up.',
  '  different_event — distinct incidents; do NOT suggest they share a gold basket.',
  'Use confidence 0–1 reflecting how strong the alignment is. Always provide a short rationale.',
  'Suggest a concise basket name in `suggestedName` (e.g. "<Vendor> <ShortTag> YYYYMM").',
  'The human is the final authority; your output is a draft.',
].join(' ');

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateAssistArticles(articles: AssistArticleInput[]): void {
  if (articles.length < MIN_ASSIST_ARTICLES || articles.length > MAX_ASSIST_ARTICLES) {
    throw new AssistInputError(
      'ARTICLE_COUNT',
      `Assist requires ${MIN_ASSIST_ARTICLES}–${MAX_ASSIST_ARTICLES} articles (got ${articles.length}).`
    );
  }
  const missingText = articles.filter((a) => !a.cleanText || !a.cleanText.trim());
  if (missingText.length > 0) {
    throw new AssistInputError(
      'MISSING_CLEAN_TEXT',
      `Assist requires extracted cleanText on every article; missing for: ${missingText
        .map((a) => a.articleId)
        .join(', ')}`
    );
  }
  const missingUrl = articles.filter((a) => !isValidHttpUrl(a.url));
  if (missingUrl.length > 0) {
    throw new AssistInputError(
      'MISSING_URL',
      `Assist requires a canonical URL on every article; missing for: ${missingUrl
        .map((a) => a.articleId)
        .join(', ')}`
    );
  }
}

function buildUserPrompt(articles: AssistArticleInput[]): string {
  return JSON.stringify({
    articles: articles.map((article) => ({
      articleId: String(article.articleId),
      url: article.url,
      title: article.title,
      sourceName: article.sourceName,
      cleanText: article.cleanText.slice(0, ASSIST_CLEAN_TEXT_SLICE),
    })),
    requiredBriefFields: ['articleId', 'brief'],
    requiredTopFields: ['recommendation', 'confidence', 'rationale', 'suggestedName', 'briefs'],
  });
}

/** Keep only brief rows for the selected articles; ignore LLM extras and duplicate ids. */
export function pickBriefsForArticles(
  llmBriefs: GoldIncidentAssistLlm['briefs'],
  articles: AssistArticleInput[]
): GoldIncidentAssistLlm['briefs'] {
  const byId = new Map<string, GoldIncidentAssistLlm['briefs'][number]>();
  for (const row of llmBriefs) {
    if (row.articleId == null || String(row.articleId).trim() === '') continue;
    const id = String(row.articleId);
    if (!byId.has(id)) byId.set(id, row);
  }
  return articles.map((article) => {
    const id = String(article.articleId);
    const row = byId.get(id);
    if (!row) {
      throw new AssistInputError(
        'BRIEFS_MISMATCH',
        `Assist briefs missing articleId "${id}".`
      );
    }
    return row;
  });
}

/** Merge LLM bullets with DB-sourced article metadata (URLs are never taken from the model). */
export function mergeAssistDraft(
  articles: AssistArticleInput[],
  llm: GoldIncidentAssistLlm
): GoldIncidentAssist {
  const briefById = new Map(llm.briefs.map((row) => [String(row.articleId), row.brief]));
  const briefs = articles.map((article) => {
    const id = String(article.articleId);
    const brief = briefById.get(id);
    if (!brief?.length) {
      throw new AssistInputError(
        'BRIEFS_MISMATCH',
        `Assist briefs missing articleId "${id}".`
      );
    }
    return {
      articleId: id,
      url: article.url,
      title: article.title,
      sourceName: article.sourceName,
      brief,
    };
  });

  return GoldIncidentAssistSchema.parse({
    recommendation: llm.recommendation,
    confidence: llm.confidence,
    rationale: llm.rationale,
    suggestedName: llm.suggestedName,
    briefs,
  });
}

export async function proposeGoldIncidentAssist(
  articles: AssistArticleInput[],
  options: { call?: SchemaCaller<GoldIncidentAssistLlm> } = {}
): Promise<GoldIncidentAssist> {
  validateAssistArticles(articles);
  const call =
    options.call ??
    ((system, user) =>
      callLLMWithSchema(system, user, GoldIncidentAssistLlmSchema, { temperature: 0.2 }));

  const llmParsed = GoldIncidentAssistLlmSchema.parse(await call(systemPrompt, buildUserPrompt(articles)));
  const llmDraft: GoldIncidentAssistLlm = {
    ...llmParsed,
    rationale: llmParsed.rationale.trim() || 'Assist did not provide a rationale.',
    suggestedName:
      llmParsed.suggestedName.trim() ||
      articles[0]?.title.slice(0, 96) ||
      'Gold incident',
    briefs: pickBriefsForArticles(llmParsed.briefs, articles),
  };

  return mergeAssistDraft(articles, llmDraft);
}

export { GoldIncidentAssistSchema, GoldIncidentAssistLlmSchema };
export type { GoldIncidentAssist, GoldIncidentAssistLlm };
