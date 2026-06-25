import { describe, expect, it } from 'vitest';
import { buildSearchQueries } from '../src/agents/searchPlannerAgent.js';
import { extractCyberFacts } from '../src/agents/extractionAgent.js';
import { decideDeduplication } from '../src/agents/dedupAgent.js';
import { env } from '../src/config/env.js';
import { monitoredVendors } from '../src/storage/vendorInventory.js';
import {
  QdrantVectorStore,
  type SimilarityMatch,
  type SecurityEventPayload,
} from '../src/storage/qdrantStore.js';
import { embedOne } from '../src/config/embeddings.js';
import type { ExtractedCyberFacts, RawArticle, SecurityEvent } from '../src/types/domain.js';

const hasKey = Boolean(env.minimaxApiKey);

describe.skipIf(!hasKey)('Search planner agent', () => {
  it('returns an array of non-empty query strings for an early-warning prompt', async () => {
    const queries = await buildSearchQueries('Find latest cyber attack news of today');
    expect(Array.isArray(queries)).toBe(true);
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(typeof q).toBe('string');
      expect(q.trim().length).toBeGreaterThan(2);
    }
  }, 90_000);
});

describe.skipIf(!hasKey)('Extraction agent', () => {
  it('extracts facts from a vendor advisory article', async () => {
    const article: RawArticle = {
      id: 'test_cyberark_advisory_1',
      title: 'Critical vulnerability actively exploited in CyberArk Privileged Access Manager',
      url: 'https://example.com/cyberark-pam-cve',
      source: 'example.com',
      snippet:
        'A zero-day flaw in CyberArk PAM is being actively exploited in the wild. CVE-2026-12345 affects all versions.',
      retrievedAt: new Date().toISOString(),
      query: 'test',
    };

    const facts: ExtractedCyberFacts = await extractCyberFacts(article);

    expect(facts.articleId).toBe(article.id);
    expect(facts.vendors).toContain('CyberArk');
    expect(['active_exploitation', 'zero_day', 'critical_vulnerability', 'vendor_advisory']).toContain(
      facts.eventType
    );
    expect(facts.cveIds.some((cve) => cve.toUpperCase() === 'CVE-2026-12345')).toBe(true);
    expect(facts.confidence).toBeTruthy();
    expect(facts.summary.length).toBeGreaterThan(10);
  });
});

/**
 * A stub QdrantVectorStore that returns a fixed set of candidate matches without
 * touching the network. Lets the dedup agent's structured-signal logic be tested
 * in isolation.
 */
class StubVectorStore extends QdrantVectorStore {
  constructor(private readonly matches: SimilarityMatch[]) {
    super('http://localhost:0');
  }
  async ensureReady(): Promise<void> {
    /* no-op */
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async findSimilar(_vector: number[]): Promise<SimilarityMatch[]> {
    return this.matches;
  }
  async isHealthy(): Promise<boolean> {
    return true;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async upsertEvent(_event: SecurityEvent, _vector: number[]): Promise<void> {
    /* no-op */
  }
}

function payloadFor(event: Partial<SecurityEvent> & Pick<SecurityEvent, 'id'>): SecurityEventPayload {
  return {
    eventId: event.id,
    canonicalTitle: event.canonicalTitle ?? '',
    eventType: event.eventType ?? 'cyber_attack',
    vendors: event.vendors ?? [],
    products: event.products ?? [],
    cveIds: event.cveIds ?? [],
    severity: event.severity ?? 'medium',
    confidence: event.confidence ?? 'medium',
    firstSeenAt: event.firstSeenAt ?? new Date().toISOString(),
    summary: event.summary ?? '',
  };
}

describe('Dedup agent (rule-based, with stub vector store)', () => {
  const baseFacts: ExtractedCyberFacts = {
    articleId: 'a1',
    eventType: 'zero_day',
    vendors: ['CyberArk'],
    products: ['Privileged Access Security'],
    cveIds: ['CVE-2026-12345'],
    threatActors: [],
    victimOrganizations: [],
    confidence: 'high',
    summary: 'Test',
    evidence: [],
  };
  const dummyVector = new Array(1536).fill(0.1);

  it('flags same CVE as material update', async () => {
    const match: SimilarityMatch = {
      eventId: 'e1',
      score: 0.95,
      payload: payloadFor({
        id: 'e1',
        eventType: 'zero_day',
        vendors: ['CyberArk'],
        products: ['Privileged Access Security'],
        cveIds: ['CVE-2026-12345'],
      }),
    };
    const decision = await decideDeduplication(baseFacts, dummyVector, {
      store: new StubVectorStore([match]),
    });

    expect(decision.relationship).toBe('same_event_material_update');
    expect(decision.matchedEventId).toBe('e1');
    expect(decision.materialUpdate).toBe(true);
    expect(decision.shouldNotify).toBe(true);
  });

  it('returns separate_event when no candidates match', async () => {
    const decision = await decideDeduplication(baseFacts, dummyVector, {
      store: new StubVectorStore([]),
    });
    expect(decision.relationship).toBe('separate_event');
    expect(decision.shouldNotify).toBe(true);
  });

  it('returns same_event_new_source for identical vendor+product+type', async () => {
    const match: SimilarityMatch = {
      eventId: 'e2',
      score: 0.88,
      payload: payloadFor({
        id: 'e2',
        eventType: 'zero_day',
        vendors: ['CyberArk'],
        products: ['Privileged Access Security'],
        cveIds: [],
      }),
    };
    const decision = await decideDeduplication(baseFacts, dummyVector, {
      store: new StubVectorStore([match]),
    });
    expect(decision.relationship).toBe('same_event_new_source');
    expect(decision.shouldNotify).toBe(false);
  });
});

describe.skipIf(!hasKey)('Embeddings client (MiniMax)', () => {
  it('returns a non-empty vector with consistent dimensions', async () => {
    let v1: number[];
    try {
      v1 = await embedOne('Cisco SD-WAN zero-day CVE-2026-20245', 'query');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/rate limit/i.test(msg)) {
        // Rate limit is an environment condition, not a code defect. Skip.
        return;
      }
      throw err;
    }
    const v2 = await embedOne('CyberArk PAM actively exploited', 'query');
    expect(v1.length).toBeGreaterThan(0);
    expect(v1.length).toBe(v2.length);
    expect(v1.every((x) => typeof x === 'number')).toBe(true);
  }, 60_000);
});

describe('Qdrant store', () => {
  it('reports unhealthy when the host is unreachable', async () => {
    const store = new QdrantVectorStore('http://localhost:1');
    const healthy = await store.isHealthy();
    expect(healthy).toBe(false);
  });
});

describe('Vendor inventory', () => {
  it('exposes at least one monitored vendor in production', () => {
    expect(monitoredVendors.length).toBeGreaterThan(0);
    const inProd = monitoredVendors.filter((v) => v.inProduction);
    expect(inProd.length).toBeGreaterThan(0);
  });

  it('every vendor has at least one alias', () => {
    for (const v of monitoredVendors) {
      expect(v.aliases.length).toBeGreaterThan(0);
    }
  });
});
