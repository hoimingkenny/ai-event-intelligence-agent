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

export type CyberClassification = z.infer<typeof CyberClassificationSchema>;
export type EventComparison = z.infer<typeof EventComparisonSchema>;
export type EventSummary = z.infer<typeof EventSummarySchema>;
