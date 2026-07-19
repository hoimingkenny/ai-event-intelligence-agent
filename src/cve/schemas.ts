import { z } from 'zod';

export const NonActionableReasonSchema = z.enum([
  'advertisement',
  'vendor_marketing',
  'generic_commentary',
  'unrelated_business_news',
  'non_cyber_content',
  'insufficient_security_context',
]);

export const CyberSignalSchema = z.enum([
  'vulnerability_disclosure',
  'active_exploitation',
  'zero_day',
  'exploit_release',
  'security_update',
  'cyber_incident',
  'data_breach',
  'ransomware',
  'threat_campaign',
]);

export const ArticleDispositionSchema = z.enum(['actionable', 'non_actionable', 'uncertain']);

export const ARTICLE_SUMMARY_MAX_CHARS = 800;

export const ArticleSummarySchema = z.object({
  // Soft-truncate oversize model output so a slightly long summary does not fail the task.
  summary: z.preprocess(
    (value) =>
      typeof value === 'string' && value.length > ARTICLE_SUMMARY_MAX_CHARS
        ? value.slice(0, ARTICLE_SUMMARY_MAX_CHARS)
        : value,
    z.string().min(1).max(ARTICLE_SUMMARY_MAX_CHARS)
  ),
});

export const ArticleDispositionResultSchema = z.object({
  disposition: ArticleDispositionSchema,
  reason: NonActionableReasonSchema.nullable(),
  signals: z.array(CyberSignalSchema),
  reasoning: z.string().min(1),
});

export const CVE_INTERPRETATION_MAX_CHARS = 1500;

export const CveInterpretationItemSchema = z.object({
  cveId: z.string().regex(/^CVE-\d{4}-\d{4,}$/),
  // Soft-truncate oversize model output so a slightly long briefing does not fail the task.
  interpretation: z.preprocess(
    (value) =>
      typeof value === 'string' && value.length > CVE_INTERPRETATION_MAX_CHARS
        ? value.slice(0, CVE_INTERPRETATION_MAX_CHARS)
        : value,
    z.string().min(1).max(CVE_INTERPRETATION_MAX_CHARS)
  ),
});

export const CveInterpretationResultSchema = z.object({
  results: z.array(CveInterpretationItemSchema).min(1),
});

export type ArticleSummary = z.infer<typeof ArticleSummarySchema>;
export type ArticleDispositionResult = z.infer<typeof ArticleDispositionResultSchema>;
export type CveInterpretationItem = z.infer<typeof CveInterpretationItemSchema>;
export type CveInterpretationResult = z.infer<typeof CveInterpretationResultSchema>;