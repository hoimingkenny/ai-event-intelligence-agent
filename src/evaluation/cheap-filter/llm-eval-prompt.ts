import type { CheapFilterEvalInput } from './llm-eval-types.js';

export const CHEAP_FILTER_LLM_EVAL_PROMPT_VERSION = 'cheap-filter-llm-eval-v1';

const SYSTEM_PROMPT = [
  'You evaluate a deterministic cheap-filter scoring engine for a cyber threat monitoring pipeline.',
  'The cheap filter only sees RSS metadata (title, summary, categories, source tier, dates, matched keywords/CVEs/vendors/products, score, decision, blocking reasons).',
  'Your job is NOT to browse the web.',
  'Your job is NOT to infer facts outside the provided text.',
  'Your job is to judge whether the cheap-filter decision and score are reasonable based ONLY on the provided metadata.',
  'Return strict JSON only — no prose, no markdown, no code fences.',
].join(' ');

const RUBRIC_PROMPT = `Evaluation labels (pick the FIRST that applies):

CRITICAL_RELEVANT:
  The article likely describes one of:
  - active exploitation, exploited in the wild, mass exploitation
  - zero-day, 0-day, KEV catalog addition
  - emergency patch, out-of-band patch, no patch available
  - ransomware campaign
  - data breach, security breach, account compromise
  - remote code execution, authentication bypass, privilege escalation
  - monitored product + CVE
  Expected decision: KEEP. Expected score band: 60-100.

RELEVANT:
  The article is cyber/security relevant and worth extracting, but urgency is unclear.
  Examples: normal vendor advisory, Patch Tuesday, vulnerability disclosure, security update,
  threat research, CVE-only article, monitored vendor + vulnerability.
  Expected decision: KEEP. Expected score band: 40-79.

BORDERLINE:
  The article may be security relevant but the RSS metadata is thin, vague, or ambiguous.
  Examples: vague vendor blog, weak security language, unknown source, vendor-only + weak
  cyber context, security category with unclear title.
  Expected decision: MAYBE_KEEP. Expected score band: 15-59.

IRRELEVANT:
  The article is likely business, marketing, product launch, hiring, partnership, earnings,
  generic tech news, or unrelated.
  Examples: "Microsoft announces AI features", "Cloudflare launches developer platform",
  earnings call, conference announcement, leadership change.
  Expected decision: DROP. Expected score band: 0-14.

Score assessment (relative to the LABEL, not the cheap filter decision):

TOO_HIGH:
  The score is higher than the RSS metadata deserves given your label.

REASONABLE:
  The score is appropriate given your label.

TOO_LOW:
  The score is lower than the RSS metadata deserves given your label.

When scoreAssessment is REASONABLE, recommendedScoreBand MUST be null.
When scoreAssessment is TOO_HIGH or TOO_LOW, recommendedScoreBand MUST be the band
where this article should land.

Relevance type tie-breakers (pick the FIRST that applies, in this exact order):
  1. KEV / actively exploited / exploited in the wild / mass exploitation -> active_exploitation
  2. zero-day / 0-day / emergency patch -> zero_day
  3. patch / security update / advisory / Patch Tuesday -> patch_or_advisory
  4. CVE / vulnerability disclosure / flaw -> vulnerability_disclosure
  5. data breach / compromise / unauthorized access / intrusion -> breach_or_incident
  6. threat research / threat intelligence / malware analysis -> threat_research
  7. earnings / hiring / partnership / product launch / conference -> business_noise
  8. generic security news without specific event -> general_security_news
  9. none of the above -> unclear

isActionableForImpactReview rubric (true only if ALL three are met):
  (a) llmLabel is CRITICAL_RELEVANT or RELEVANT, AND
  (b) the cheap filter decision disagrees with expectedDecision, AND
  (c) the disagreement is a false-negative risk (cheap filter dropped or
      demoted something that should have been KEEP).
Otherwise false.

Important rules:

- Vendor name alone is not enough for high relevance. Product names are stronger than vendor names.
- CVE is a strong deterministic cyber signal.
- Active exploitation, zero-day, no patch, emergency patch, KEV, RCE, authentication bypass,
  and privilege escalation are strong urgent signals.
- Patch, patched, and security update are medium signals unless combined with exploitation,
  zero-day, CVE, or monitored product.
- Product launch, earnings, partnership, conference, hiring, and generic AI/product
  announcements are usually irrelevant.
- If the source is official vendor advisory, government/CERT, or high-trust research,
  be more tolerant of thin RSS summaries.
- If uncertain, choose BORDERLINE rather than IRRELEVANT.
- Do NOT echo the cheap filter decision as expectedDecision. expectedDecision is the decision
  you would have made if you had been the cheap filter.

Return this exact JSON shape and nothing else:
{
  "articleId": "<string>",
  "llmLabel": "CRITICAL_RELEVANT | RELEVANT | BORDERLINE | IRRELEVANT",
  "expectedDecision": "KEEP | MAYBE_KEEP | DROP",
  "scoreAssessment": "TOO_HIGH | REASONABLE | TOO_LOW",
  "recommendedScoreBand": "80-100 | 60-79 | 40-59 | 15-39 | 0-14" | null,
  "isActionableForImpactReview": true | false,
  "relevanceType": "active_exploitation | zero_day | patch_or_advisory | vulnerability_disclosure | breach_or_incident | threat_research | business_noise | general_security_news | unclear",
  "scoringIssue": "none | vendor_score_too_high | product_score_too_high | product_score_too_low | critical_keyword_score_too_low | medium_keyword_score_too_high | noisy_vendor_penalty_too_weak | negative_penalty_too_weak | negative_penalty_too_strong | stale_penalty_too_strong | stale_penalty_too_weak | source_tier_score_too_high | source_tier_score_too_low | missing_keyword | missing_vendor_alias | missing_product_alias | rss_summary_too_thin | ambiguous_summary | threshold_too_high | threshold_too_low | recency_boost_too_strong | rss_categories_overcounted | language_variant_missing | unclear",
  "explanation": "Brief explanation based only on the RSS metadata.",
  "suggestedRuleChanges": [],
  "suggestedKeywordsToAdd": [],
  "suggestedVendorProductAliasesToAdd": []
}`;

export function buildCheapFilterLlmEvalPrompt(input: CheapFilterEvalInput): {
  systemPrompt: string;
  userPrompt: string;
  promptVersion: string;
} {
  const userPrompt = [
    RUBRIC_PROMPT,
    '',
    'Input:',
    JSON.stringify({
      articleId: input.articleId,
      title: input.title,
      rssSummary: input.rssSummary,
      rssCategories: input.rssCategories,
      sourceName: input.sourceName,
      sourceTier: input.sourceTier,
      publishedAt: input.publishedAt,
      cheapFilterDecision: input.cheapFilterDecision,
      cheapFilterScore: input.cheapFilterScore,
      matchedSignals: input.matchedSignals,
      blockingReasons: input.blockingReasons,
    }, null, 2),
    '',
    'Return the JSON shape above. articleId in your response MUST equal the articleId in Input exactly.',
  ].join('\n');

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    promptVersion: CHEAP_FILTER_LLM_EVAL_PROMPT_VERSION,
  };
}

// Repair prompt used when the LLM returns something that fails Zod parsing.
// We do NOT change the rubric — we just tell the model the previous response
// did not match the required JSON shape and ask it to emit strict JSON.
export function buildCheapFilterLlmEvalRepairPrompt(priorUserPrompt: string, priorRaw: string, errorMessage: string): string {
  return [
    'Your previous response did not match the required JSON shape.',
    `Validation error: ${errorMessage}`,
    '',
    'Previous response (verbatim):',
    '"""',
    priorRaw,
    '"""',
    '',
    'Re-emit the response as strict JSON matching the schema in the rubric below.',
    'Do not add prose, do not wrap in markdown, do not include code fences.',
    '',
    priorUserPrompt,
  ].join('\n');
}