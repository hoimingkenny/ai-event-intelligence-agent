import { extractCyberFacts } from '../agents/extractionAgent.js';
import { decideDeduplication } from '../agents/dedupAgent.js';
import { scoreRisk } from '../agents/riskScoringAgent.js';
import { store } from '../storage/inMemoryStore.js';
import { qdrantStore } from '../storage/qdrantStore.js';
import { embedOne } from '../config/embeddings.js';
import type { ExtractedCyberFacts, RawArticle, SecurityEvent } from '../types/domain.js';

function buildEmbeddableText(facts: ExtractedCyberFacts): string {
  const parts = [
    facts.eventType,
    facts.vendors.join(' '),
    facts.products.join(' '),
    facts.cveIds.join(' '),
    facts.summary,
  ];
  return parts.filter(Boolean).join(' — ');
}

function buildCanonicalTitle(facts: ExtractedCyberFacts): string {
  const subject = facts.vendors.length > 0 ? facts.vendors.join(', ') : 'Unknown vendor';
  const cve = facts.cveIds.length > 0 ? ` (${facts.cveIds.join(', ')})` : '';
  return `${facts.eventType}: ${subject}${cve}`;
}

export async function triageArticle(article: RawArticle): Promise<SecurityEvent | null> {
  const facts = await extractCyberFacts(article);

  if (facts.eventType === 'irrelevant') return null;

  // Generate embedding for vector-based candidate retrieval.
  const embedText = buildEmbeddableText(facts);
  const vector = await embedOne(embedText, 'query');

  const dedup = await decideDeduplication(facts, vector);

  if (dedup.matchedEventId && dedup.relationship !== 'separate_event') {
    const existing = store.securityEvents.get(dedup.matchedEventId);
    if (existing) {
      existing.articleIds = Array.from(new Set([...existing.articleIds, article.id]));
      existing.lastMaterialUpdateAt = dedup.materialUpdate
        ? new Date().toISOString()
        : existing.lastMaterialUpdateAt;
      store.saveEvent(existing);
      return existing;
    }
  }

  const severity = scoreRisk(facts);
  const event: SecurityEvent = {
    id: `evt_${crypto.randomUUID()}`,
    canonicalTitle: buildCanonicalTitle(facts),
    eventType: facts.eventType,
    vendors: facts.vendors,
    products: facts.products,
    cveIds: facts.cveIds,
    firstSeenAt: new Date().toISOString(),
    lastMaterialUpdateAt: new Date().toISOString(),
    severity,
    confidence: facts.confidence,
    summary: facts.summary,
    recommendedActions: [
      'Confirm whether the affected product is deployed internally.',
      'Check vendor advisory and mitigation guidance.',
      'Ask the system owner to confirm exposure and version.',
    ],
    articleIds: [article.id],
  };

  store.saveEvent(event);

  // Index in Qdrant for future dedup. Failures are non-fatal.
  try {
    await qdrantStore.upsertEvent(event, vector);
  } catch {
    // Qdrant indexing failure does not break the pipeline.
  }

  return event;
}
