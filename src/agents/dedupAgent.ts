import { z } from 'zod';
import type { DedupRelationship, ExtractedCyberFacts, SecurityEvent } from '../types/domain.js';
import { callLLMWithSchema } from './llmHelpers.js';
import { qdrantStore, type SimilarityMatch, QdrantVectorStore } from '../storage/qdrantStore.js';
import { env } from '../config/env.js';

export interface DedupDecision {
  relationship: DedupRelationship;
  matchedEventId?: string;
  matchedScore?: number;
  materialUpdate: boolean;
  shouldNotify: boolean;
  reason: string;
}

function sameCve(facts: ExtractedCyberFacts, candidate: SecurityEvent): boolean {
  if (facts.cveIds.length === 0) return false;
  return facts.cveIds.some((cve) => candidate.cveIds.includes(cve));
}

function sameVendorProductType(facts: ExtractedCyberFacts, candidate: SecurityEvent): boolean {
  return (
    candidate.eventType === facts.eventType &&
    facts.vendors.some((v) => candidate.vendors.includes(v)) &&
    facts.products.some((p) => candidate.products.includes(p))
  );
}

const adjudicationSchema = z.object({
  relationship: z.enum([
    'same_article_duplicate',
    'same_event_no_new_information',
    'same_event_new_source',
    'same_event_material_update',
    'related_but_separate_event',
    'separate_event',
    'uncertain_need_human_review',
  ]),
  materialUpdate: z.boolean(),
  shouldNotify: z.boolean(),
  reason: z.string(),
});

async function llmAdjudicate(
  facts: ExtractedCyberFacts,
  matches: SimilarityMatch[]
): Promise<DedupDecision> {
  const summary = matches
    .slice(0, 3)
    .map(
      (m) =>
        `- eventId=${m.eventId} score=${m.score.toFixed(3)} type=${m.payload.eventType} ` +
        `vendors=[${m.payload.vendors.join(',')}] products=[${m.payload.products.join(',')}] ` +
        `cves=[${m.payload.cveIds.join(',')}] summary="${m.payload.summary.slice(0, 200)}"`
    )
    .join('\n');

  const systemPrompt = `You are a cyber-event deduplication adjudicator. Given a new event's extracted facts and a list of similar recent candidate events (retrieved by vector similarity), decide the deduplication relationship. Be conservative: when uncertain, prefer "uncertain_need_human_review". Return JSON with: relationship, materialUpdate, shouldNotify, reason.`;
  const userPrompt = `New event facts:\ntype=${facts.eventType}\nvendors=[${facts.vendors.join(',')}]\nproducts=[${facts.products.join(',')}]\ncves=[${facts.cveIds.join(',')}]\nsummary="${facts.summary}"\n\nSimilar recent candidate events:\n${summary}`;

  try {
    const parsed = await callLLMWithSchema(systemPrompt, userPrompt, adjudicationSchema);
    return {
      relationship: parsed.relationship,
      materialUpdate: parsed.materialUpdate,
      shouldNotify: parsed.shouldNotify,
      reason: parsed.reason,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      relationship: 'uncertain_need_human_review',
      materialUpdate: true,
      shouldNotify: facts.eventType !== 'irrelevant' && facts.vendors.length > 0,
      reason: `LLM adjudication unavailable (${message}); flagged for human review.`,
    };
  }
}

/**
 * Resolve deduplication using Qdrant vector retrieval + structured-signal overrides.
 *
 * @param facts Extracted cyber facts for the new event
 * @param vector Embedding of the new event text (produced via the `query` embedding type)
 * @param options Optional: store override (for tests) and excludeEventId
 */
export async function decideDeduplication(
  facts: ExtractedCyberFacts,
  vector: number[],
  options: { store?: QdrantVectorStore; excludeEventId?: string } = {}
): Promise<DedupDecision> {
  const store = options.store ?? qdrantStore;

  // 1) Vector retrieval — pull structurally similar events from Qdrant.
  let matches: SimilarityMatch[] = [];
  let qdrantAvailable = true;
  try {
    matches = await store.findSimilar(vector, {
      limit: 5,
      minScore: env.dedupSimilarityThreshold,
      excludeEventId: options.excludeEventId,
    });
  } catch {
    qdrantAvailable = false;
  }

  // 2) Structured-signal overrides on top of vector matches.
  for (const match of matches) {
    const candidate: SecurityEvent = matchToSecurityEvent(match);
    if (sameCve(facts, candidate)) {
      return {
        relationship: 'same_event_material_update',
        matchedEventId: candidate.id,
        matchedScore: match.score,
        materialUpdate: true,
        shouldNotify: true,
        reason: `Matched existing event ${candidate.id} by CVE; cosine=${match.score.toFixed(3)}.`,
      };
    }
    if (sameVendorProductType(facts, candidate)) {
      return {
        relationship: 'same_event_new_source',
        matchedEventId: candidate.id,
        matchedScore: match.score,
        materialUpdate: false,
        shouldNotify: false,
        reason: `Same vendor/product/eventType as ${candidate.id}; cosine=${match.score.toFixed(3)}.`,
      };
    }
  }

  // 3) High-similarity ambiguous case — no structured match, but vectors are close.
  //    Ask the LLM to adjudicate.
  if (matches.length > 0) {
    const decision = await llmAdjudicate(facts, matches);
    if (decision.relationship !== 'separate_event') {
      return { ...decision, matchedEventId: matches[0].eventId, matchedScore: matches[0].score };
    }
    return { ...decision, matchedScore: matches[0].score };
  }

  // 4) No vector matches.
  return {
    relationship: 'separate_event',
    materialUpdate: true,
    shouldNotify: facts.eventType !== 'irrelevant' && facts.vendors.length > 0,
    reason: qdrantAvailable
      ? 'No similar events found in vector index above similarity threshold.'
      : 'Qdrant unavailable; structured-signal dedup only — no candidate match found.',
  };
}

function matchToSecurityEvent(match: SimilarityMatch): SecurityEvent {
  return {
    id: match.eventId,
    canonicalTitle: match.payload.canonicalTitle,
    eventType: match.payload.eventType,
    vendors: match.payload.vendors,
    products: match.payload.products,
    cveIds: match.payload.cveIds,
    firstSeenAt: match.payload.firstSeenAt,
    lastMaterialUpdateAt: match.payload.firstSeenAt,
    severity: match.payload.severity,
    confidence: match.payload.confidence,
    summary: match.payload.summary,
    recommendedActions: [],
    articleIds: [],
  };
}
