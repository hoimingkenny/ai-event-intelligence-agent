import { callLLMWithSchema } from '../agents/llmHelpers.js';
import type { ArticleRecord } from '../db/repositories/article.repository.js';
import { ArticleDigestSchema, type ArticleDigest } from '../llm/schemas.js';
import {
  ArticleDispositionResultSchema,
  ArticleSummarySchema,
  CveRelevanceItemSchema,
  CveRelevanceResultSchema,
  type ArticleDispositionResult,
  type ArticleSummary,
  type CveRelevanceItem,
  type CveRelevanceResult,
} from './schemas.js';

export type SchemaCaller<T> = (systemPrompt: string, userPrompt: string) => Promise<T>;

export const ARTICLE_SUMMARY_PROMPT_VERSION = 'cve-mvp-summary-v1';
export const ARTICLE_DISPOSITION_PROMPT_VERSION = 'cve-mvp-disposition-v1';
export const ARTICLE_CVE_RELEVANCE_PROMPT_VERSION = 'cve-mvp-cve-relevance-v1';
export const RELEVANCE_CHUNK_SIZE = 10;

const summarySystemPrompt = [
  'You produce a short factual summary of a cyber news article for analyst triage.',
  'The article may be an advertisement, vendor marketing, generic commentary, an incident report,',
  'or a vulnerability disclosure. Summarise what the article is actually about in 1-3 sentences.',
  'Do NOT decide whether the article is relevant, actionable, or related to any specific vendor.',
  'Do NOT include CVE IDs in the summary; that information is recorded separately.',
  'Return strict JSON only with key "summary".',
].join(' ');

const dispositionSystemPrompt = [
  'You classify a cyber news article for analyst triage under the CVE MVP workflow.',
  'disposition MUST be exactly one of: actionable, non_actionable, uncertain.',
  'When disposition is non_actionable, reason MUST be exactly one of:',
  'advertisement, vendor_marketing, generic_commentary, unrelated_business_news,',
  'non_cyber_content, insufficient_security_context. When disposition is actionable or',
  'uncertain, reason MUST be null.',
  'signals is a multi-label array that may be empty; values MUST come from:',
  'vulnerability_disclosure, active_exploitation, zero_day, exploit_release, security_update,',
  'cyber_incident, data_breach, ransomware, threat_campaign.',
  'A CVE mention does NOT make an article actionable. Generic cyber commentary is NOT actionable.',
  'Return strict JSON only with keys disposition, reason, signals, reasoning.',
].join(' ');

const relevanceSystemPrompt = [
  'You assess whether each explicitly mentioned CVE in an article is genuinely relevant.',
  'cveId MUST exactly match one of the provided CVE identifiers; never invent new ones.',
  'relevance MUST be exactly one of: relevant, not_relevant, uncertain.',
  'evidence is one short sentence explaining the judgement, anchored to the article.',
  'Return strict JSON only with key "results" containing one item per input CVE.',
].join(' ');

export interface GenerateSummaryOptions {
  call?: SchemaCaller<ArticleSummary>;
}

export async function generateArticleSummary(
  article: ArticleRecord,
  options: GenerateSummaryOptions = {}
): Promise<ArticleSummary> {
  const call =
    options.call ??
    ((system, user) => callLLMWithSchema(system, user, ArticleSummarySchema, { temperature: 0.1 }));
  return call(
    summarySystemPrompt,
    JSON.stringify({
      title: article.title,
      sourceName: article.sourceName,
      rssSummary: article.rssSummary,
      cleanText: article.cleanText?.slice(0, 12000),
    })
  );
}

export interface GenerateDispositionOptions {
  call?: SchemaCaller<ArticleDispositionResult>;
}

export async function generateArticleDisposition(
  article: ArticleRecord,
  options: GenerateDispositionOptions = {}
): Promise<ArticleDispositionResult> {
  const call =
    options.call ??
    ((system, user) =>
      callLLMWithSchema(system, user, ArticleDispositionResultSchema, { temperature: 0.1 }));
  return call(
    dispositionSystemPrompt,
    JSON.stringify({
      title: article.title,
      sourceName: article.sourceName,
      rssSummary: article.rssSummary,
      cleanText: article.cleanText?.slice(0, 12000),
    })
  );
}

export interface GenerateRelevanceOptions {
  call?: SchemaCaller<CveRelevanceResult>;
}

export async function generateCveRelevance(
  article: ArticleRecord,
  cveIds: string[],
  options: GenerateRelevanceOptions = {}
): Promise<CveRelevanceItem[]> {
  if (cveIds.length === 0) return [];
  const call =
    options.call ??
    ((system, user) =>
      callLLMWithSchema(system, user, CveRelevanceResultSchema, { temperature: 0.1 }));

  const merged = new Map<string, CveRelevanceItem>();
  for (let i = 0; i < cveIds.length; i += RELEVANCE_CHUNK_SIZE) {
    const chunk = cveIds.slice(i, i + RELEVANCE_CHUNK_SIZE);
    const response = await call(
      relevanceSystemPrompt,
      JSON.stringify({
        cves: chunk,
        article: {
          title: article.title,
          sourceName: article.sourceName,
          rssSummary: article.rssSummary,
          cleanText: article.cleanText?.slice(0, 12000),
        },
      })
    );
    for (const item of response.results) {
      const parsed = CveRelevanceItemSchema.parse(item);
      if (!chunk.includes(parsed.cveId)) continue;
      merged.set(parsed.cveId, parsed);
    }
  }

  return cveIds.map((cveId) => merged.get(cveId) ?? {
    cveId,
    relevance: 'uncertain' as const,
    evidence: 'Model returned no assessment for this CVE.',
  });
}

/** Re-exported for callers that want to share the existing article-digest path. */
export { ArticleDigestSchema, type ArticleDigest };