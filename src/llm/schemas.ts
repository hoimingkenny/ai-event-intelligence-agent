import { z } from 'zod';

export const VendorRoleSchema = z.enum([
  'affected',
  'reporting',
  'mitigating',
  'researching',
  'patching',
  'unrelated',
  'unknown',
]);

export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const UrgencySchema = z.enum(['P1', 'P2', 'P3', 'P4']);

export const CyberClassificationSchema = z.object({
  cyberRelevant: z.boolean(),
  eventType: z.string().min(1),
  severity: SeveritySchema,
  urgency: UrgencySchema,
  confidence: z.number().min(0).max(1),
  vendorRoles: z.array(
    z.object({
      vendor: z.string().min(1),
      role: VendorRoleSchema,
      rationale: z.string().min(1),
    })
  ),
  affectedProducts: z.array(z.string()),
  cves: z.array(z.string()),
  reasoning: z.string().min(1),
});

/** Per-article LLM digest vs monitored inventory (analyst-eval). */
export const ArticleDigestSchema = z.object({
  relatedToMonitoredInventory: z.boolean(),
  incidentSummary: z.string().min(1).nullable(),
  cves: z.array(z.string()),
  matchedVendors: z.array(z.string()),
  matchedProducts: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});

export const EventComparisonSchema = z.object({
  relationship: z.enum(['same_event', 'related_but_different_event', 'unrelated']),
  confidence: z.number().min(0).max(1),
  isMaterialUpdate: z.boolean(),
  rationale: z.string().min(1),
});

export const EventSummarySchema = z.object({
  title: z.string().min(1).max(96),
  summary: z.string().min(1).max(1200),
  severity: SeveritySchema,
  urgency: UrgencySchema,
  confidence: z.number().min(0).max(1),
  keyFacts: z.array(z.string()).max(10),
  recommendedActions: z.array(z.string()).max(10),
});

export const GoldIncidentAssistArticleSchema = z.object({
  articleId: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  sourceName: z.string().min(1),
  brief: z.array(z.string().min(1)).min(1).max(8),
});

/** LLM output: bullets keyed by articleId only — URLs come from the DB at merge time. */
function coerceNullToString(value: unknown): unknown {
  if (value == null) return '';
  return value;
}

function coerceBriefBullets(value: unknown): unknown {
  if (value == null) return ['Summary unavailable from assist.'];
  if (Array.isArray(value)) {
    return value
      .map((item) => (item == null ? '' : String(item).trim()))
      .filter(Boolean)
      .slice(0, 8);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return ['Summary unavailable from assist.'];
    const lines = trimmed
      .split(/\r?\n+/)
      .map((line) => line.replace(/^[\s\-*•]+\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 8);
    return lines.length > 0 ? lines : [trimmed];
  }
  return value;
}

function normalizeAssistRecommendation(value: unknown): unknown {
  if (value == null) return 'mixed';
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'sameevent') return 'same_event';
  if (normalized === 'differentevent' || normalized === 'different_event') return 'different_event';
  return normalized;
}

function coerceBriefsList(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

export const GoldIncidentAssistLlmSchema = z.object({
  recommendation: z.preprocess(
    normalizeAssistRecommendation,
    z.enum(['same_event', 'mixed', 'different_event'])
  ),
  confidence: z.coerce.number().min(0).max(1),
  rationale: z.preprocess(coerceNullToString, z.string()),
  suggestedName: z.preprocess(coerceNullToString, z.string().max(96)),
  briefs: z.preprocess(
    coerceBriefsList,
    z
      .array(
        z.object({
          articleId: z.preprocess(
            coerceNullToString,
            z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1))
          ),
          brief: z.preprocess(coerceBriefBullets, z.array(z.string().min(1)).min(1).max(8)),
        })
      )
      .min(1)
  ),
});

export const GoldIncidentAssistSchema = z.object({
  recommendation: z.enum(['same_event', 'mixed', 'different_event']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  suggestedName: z.string().trim().min(1).max(96),
  briefs: z.array(GoldIncidentAssistArticleSchema).min(2).max(5),
});

export type CyberClassification = z.infer<typeof CyberClassificationSchema>;
export type ArticleDigest = z.infer<typeof ArticleDigestSchema>;
export type EventComparison = z.infer<typeof EventComparisonSchema>;
export type EventSummary = z.infer<typeof EventSummarySchema>;
export type GoldIncidentAssist = z.infer<typeof GoldIncidentAssistSchema>;
export type GoldIncidentAssistArticle = z.infer<typeof GoldIncidentAssistArticleSchema>;
export type GoldIncidentAssistLlm = z.infer<typeof GoldIncidentAssistLlmSchema>;
