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

export const ArticleSummarySchema = z.object({
  summary: z.string().min(1).max(800),
});

export const ArticleDispositionResultSchema = z.object({
  disposition: ArticleDispositionSchema,
  reason: NonActionableReasonSchema.nullable(),
  signals: z.array(CyberSignalSchema),
  reasoning: z.string().min(1),
});

export const CveRelevanceItemSchema = z.object({
  cveId: z.string().regex(/^CVE-\d{4}-\d{4,}$/),
  relevance: z.enum(['relevant', 'not_relevant', 'uncertain']),
  evidence: z.string().min(1).max(400),
});

export const CveRelevanceResultSchema = z.object({
  results: z.array(CveRelevanceItemSchema).min(1),
});

export type ArticleSummary = z.infer<typeof ArticleSummarySchema>;
export type ArticleDispositionResult = z.infer<typeof ArticleDispositionResultSchema>;
export type CveRelevanceItem = z.infer<typeof CveRelevanceItemSchema>;
export type CveRelevanceResult = z.infer<typeof CveRelevanceResultSchema>;