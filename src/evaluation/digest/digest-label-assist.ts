/**
 * Digest gold label assist — drafts gold fields for human Accept/Edit.
 * Never writes gold; the analyst must explicitly save.
 */

import { z } from 'zod';
import { callLLMWithSchema } from '../../agents/llmHelpers.js';
import { ArticleDigestSchema, type ArticleDigest } from '../../llm/schemas.js';
import type { SchemaCaller } from '../../llm/article-digest.js';
import type {
  DigestGoldArticleSnapshot,
  DigestGoldFields,
} from './digest-gold-types.js';
import type { VendorProduct } from '../../types/domain.js';

export const DigestGoldAssistSchema = z.object({
  relatedToMonitoredInventory: z.boolean(),
  matchedVendors: z.array(z.string()),
  matchedProducts: z.array(z.string()),
  cves: z.array(z.string()),
  reasoning: z.string().min(1),
});

export type DigestGoldAssistDraft = z.infer<typeof DigestGoldAssistSchema>;

const systemPrompt = [
  'You draft digest gold labels for a cyber article eval dataset.',
  'Given article text and the monitored inventory, propose whether the article is',
  'related to monitored inventory (vulnerability, incident, attack, or product advisory).',
  'matchedVendors and matchedProducts must use exact inventory vendor/product names only.',
  'When unrelated, return empty matched arrays.',
  'cves lists CVE IDs mentioned (empty if none).',
  'Return strict JSON only.',
  'The human is the final authority; your output is a draft only.',
].join(' ');

export function draftDigestGoldFromStoredDigest(digest: unknown): DigestGoldFields | null {
  const parsed = ArticleDigestSchema.safeParse(digest);
  if (!parsed.success) return null;
  return digestGoldFieldsFromArticleDigest(parsed.data);
}

export function digestGoldFieldsFromArticleDigest(digest: ArticleDigest): DigestGoldFields {
  return {
    relatedToMonitoredInventory: digest.relatedToMonitoredInventory,
    matchedVendors: digest.matchedVendors,
    matchedProducts: digest.matchedProducts,
    cves: digest.cves,
    humanReason: null,
  };
}

export async function proposeDigestGoldAssist(
  input: {
    article: DigestGoldArticleSnapshot;
    inventory: VendorProduct[];
    storedDigest?: unknown;
  },
  options: { call?: SchemaCaller<DigestGoldAssistDraft> } = {}
): Promise<DigestGoldAssistDraft> {
  const call =
    options.call ??
    ((system, user) =>
      callLLMWithSchema(system, user, DigestGoldAssistSchema, { temperature: 0.1 }));

  return call(
    systemPrompt,
    JSON.stringify({
      monitoredInventory: input.inventory.map((item) => ({
        vendor: item.vendor,
        product: item.product,
        aliases: item.aliases,
      })),
      article: {
        title: input.article.title,
        sourceName: input.article.sourceName,
        rssSummary: input.article.rssSummary,
        cleanText: input.article.cleanText,
      },
      storedDigestHint: input.storedDigest ?? null,
    })
  );
}
