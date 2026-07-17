/**
 * Digest agreement report — on-demand LLM judge of gold vs prediction.
 * Diagnostic only: never writes gold and never feeds soft gates.
 */

import { z } from 'zod';
import { callLLMWithSchema } from '../../agents/llmHelpers.js';
import type { SchemaCaller } from '../../llm/article-digest.js';
import type { DigestGoldFields } from './digest-gold-types.js';
import type { DigestEvalPredictionFields } from '../../../eval/types/digest-eval.types.js';
import { setsEqual } from '../../../eval/utils/set-metrics.js';
import { runWithConcurrency } from '../../utils/concurrency.js';
import { env } from '../../config/env.js';

export const DigestAgreementJudgementSchema = z.object({
  relatedAgree: z.boolean(),
  vendorsAgree: z.boolean().nullable(),
  productsAgree: z.boolean().nullable(),
  cvesAgree: z.boolean(),
  reason: z.string().min(1),
});

export type DigestAgreementJudgement = z.infer<typeof DigestAgreementJudgementSchema>;

export interface DigestAgreementSampleInput {
  articleId: string;
  title: string | null;
  gold: DigestGoldFields;
  prediction: DigestEvalPredictionFields;
}

export interface DigestAgreementSampleResult extends DigestAgreementSampleInput {
  judgement: DigestAgreementJudgement;
  /** Deterministic field matches (not LLM) for UI cross-check. */
  exact: {
    related: boolean;
    vendors: boolean | null;
    products: boolean | null;
    cves: boolean;
  };
}

export interface DigestAgreementReport {
  generatedAt: string;
  runId: string | null;
  sampleCount: number;
  relatedAgreeRate: number;
  vendorAgreeRate: number | null;
  productAgreeRate: number | null;
  cveAgreeRate: number;
  samples: DigestAgreementSampleResult[];
}

const systemPrompt = [
  'You compare a human digest gold label to a model prediction for one cyber article.',
  'Decide whether each field agrees for practical eval purposes (same relatedness bit;',
  'same vendor/product sets ignoring order/case; same CVE sets ignoring order/case).',
  'vendorsAgree and productsAgree must be null when gold relatedToMonitoredInventory is false.',
  'Give a short reason (one or two sentences). Return strict JSON only.',
  'This is diagnostic only — you do not write gold labels.',
].join(' ');

export function exactFieldAgreement(
  gold: DigestGoldFields,
  prediction: DigestEvalPredictionFields
): DigestAgreementSampleResult['exact'] {
  return {
    related: gold.relatedToMonitoredInventory === prediction.relatedToMonitoredInventory,
    vendors: gold.relatedToMonitoredInventory
      ? setsEqual(gold.matchedVendors, prediction.matchedVendors)
      : null,
    products: gold.relatedToMonitoredInventory
      ? setsEqual(gold.matchedProducts, prediction.matchedProducts)
      : null,
    cves: setsEqual(gold.cves, prediction.cves),
  };
}

export async function judgeDigestAgreementSample(
  sample: DigestAgreementSampleInput,
  options: { call?: SchemaCaller<DigestAgreementJudgement> } = {}
): Promise<DigestAgreementJudgement> {
  const call =
    options.call ??
    ((system, user) =>
      callLLMWithSchema(system, user, DigestAgreementJudgementSchema, { temperature: 0.1 }));

  return call(
    systemPrompt,
    JSON.stringify({
      articleId: sample.articleId,
      title: sample.title,
      gold: {
        relatedToMonitoredInventory: sample.gold.relatedToMonitoredInventory,
        matchedVendors: sample.gold.matchedVendors,
        matchedProducts: sample.gold.matchedProducts,
        cves: sample.gold.cves,
      },
      prediction: sample.prediction,
    })
  );
}

export async function runDigestAgreementReport(
  samples: DigestAgreementSampleInput[],
  options: {
    runId?: string | null;
    concurrency?: number;
    call?: SchemaCaller<DigestAgreementJudgement>;
  } = {}
): Promise<DigestAgreementReport> {
  const results: DigestAgreementSampleResult[] = [];
  const concurrency = options.concurrency ?? env.llmConcurrency;

  await runWithConcurrency(samples, concurrency, async (sample) => {
    const judgement = await judgeDigestAgreementSample(sample, { call: options.call });
    results.push({
      ...sample,
      judgement,
      exact: exactFieldAgreement(sample.gold, sample.prediction),
    });
  });

  results.sort((a, b) => a.articleId.localeCompare(b.articleId, undefined, { numeric: true }));

  const relatedYes = results.filter((r) => r.judgement.relatedAgree).length;
  const vendorJudged = results.filter((r) => r.judgement.vendorsAgree !== null);
  const productJudged = results.filter((r) => r.judgement.productsAgree !== null);
  const cveYes = results.filter((r) => r.judgement.cvesAgree).length;

  return {
    generatedAt: new Date().toISOString(),
    runId: options.runId ?? null,
    sampleCount: results.length,
    relatedAgreeRate: results.length === 0 ? 0 : relatedYes / results.length,
    vendorAgreeRate:
      vendorJudged.length === 0
        ? null
        : vendorJudged.filter((r) => r.judgement.vendorsAgree === true).length / vendorJudged.length,
    productAgreeRate:
      productJudged.length === 0
        ? null
        : productJudged.filter((r) => r.judgement.productsAgree === true).length /
          productJudged.length,
    cveAgreeRate: results.length === 0 ? 0 : cveYes / results.length,
    samples: results,
  };
}
