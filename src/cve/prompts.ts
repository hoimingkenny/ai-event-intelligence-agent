import { callLLMWithSchema } from '../agents/llmHelpers.js';
import type { ArticleRecord } from '../db/repositories/article.repository.js';
import { ArticleDigestSchema, type ArticleDigest } from '../llm/schemas.js';
import {
  ArticleDispositionResultSchema,
  ArticleSummarySchema,
  CveInterpretationItemSchema,
  CveInterpretationResultSchema,
  type ArticleDispositionResult,
  type ArticleSummary,
  type CveInterpretationItem,
  type CveInterpretationResult,
} from './schemas.js';

export type SchemaCaller<T> = (systemPrompt: string, userPrompt: string) => Promise<T>;

export const ARTICLE_SUMMARY_PROMPT_VERSION = 'cve-mvp-summary-v2';
export const ARTICLE_DISPOSITION_PROMPT_VERSION = 'cve-mvp-disposition-v1';
export const ARTICLE_CVE_INTERPRETATION_PROMPT_VERSION = 'cve-mvp-cve-interpretation-v3';
export const INTERPRETATION_CHUNK_SIZE = 10;

const summarySystemPrompt = [
  'You produce a short factual summary of a cyber news article for analyst triage.',
  'The article may be an advertisement, vendor marketing, generic commentary, an incident report,',
  'or a vulnerability disclosure. Summarise what the article is actually about in 1-3 sentences',
  '(at most 800 characters).',
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

const interpretationSystemPrompt = [
  'You are a security analyst briefing a manager on the CVEs named in a news article.',
  'For each provided CVE identifier, write 2-4 plain-language sentences covering, as far as',
  'the article supports: (1) what the CVE is — the flaw type and the affected product,',
  'vendor, or system named in the article; (2) the impact — what an attacker could do',
  '(e.g. remote code execution, privilege escalation, data theft) and which systems or',
  'assets are exposed; (3) how serious and urgent it looks based on the article — active',
  'exploitation or in-the-wild use, ransomware or campaign links, whether a patch or',
  'mitigation exists, and anything that would make a manager treat it as actionable.',
  'Write as a briefing, not as commentary about the article. Do NOT judge whether the',
  'article is really "about" this CVE, and do NOT assign a relevance verdict.',
  'Ground every statement in the article text; if the article does not say something,',
  'omit it rather than speculating. cveId MUST exactly match one of the provided CVE',
  'identifiers; never invent new ones.',
  'Return strict JSON only with key "results": an array with one object per input CVE.',
  'Each object MUST use exactly these keys: "cveId" (string) and "interpretation" (string,',
  'the 2-4 sentence briefing, at most 1500 characters). Do not use other field names such',
  'as evidence, summary, relevance, or description.',
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

export interface GenerateInterpretationOptions {
  call?: SchemaCaller<CveInterpretationResult>;
}

export async function generateCveInterpretation(
  article: ArticleRecord,
  cveIds: string[],
  options: GenerateInterpretationOptions = {}
): Promise<CveInterpretationItem[]> {
  if (cveIds.length === 0) return [];
  const call =
    options.call ??
    ((system, user) =>
      callLLMWithSchema(system, user, CveInterpretationResultSchema, { temperature: 0.1 }));

  const merged = new Map<string, CveInterpretationItem>();
  for (let i = 0; i < cveIds.length; i += INTERPRETATION_CHUNK_SIZE) {
    const chunk = cveIds.slice(i, i + INTERPRETATION_CHUNK_SIZE);
    const response = await call(
      interpretationSystemPrompt,
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
      const parsed = CveInterpretationItemSchema.parse(item);
      if (!chunk.includes(parsed.cveId)) continue;
      merged.set(parsed.cveId, parsed);
    }
  }

  return cveIds.map((cveId) => merged.get(cveId) ?? {
    cveId,
    interpretation: 'Model returned no interpretation for this CVE.',
  });
}

/** Re-exported for callers that want to share the existing article-digest path. */
export { ArticleDigestSchema, type ArticleDigest };