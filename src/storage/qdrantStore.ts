import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../config/env.js';
import { getEmbeddingDimensions } from '../config/embeddings.js';
import type { CyberEventType, SecurityEvent } from '../types/domain.js';

export interface SecurityEventPayload {
  eventId: string;
  canonicalTitle: string;
  eventType: CyberEventType;
  vendors: string[];
  products: string[];
  cveIds: string[];
  severity: SecurityEvent['severity'];
  confidence: SecurityEvent['confidence'];
  firstSeenAt: string;
  summary: string;
}

export interface SimilarityMatch {
  eventId: string;
  score: number;
  payload: SecurityEventPayload;
}

export class QdrantVectorStore {
  private client: QdrantClient;
  private collection: string;
  private dimensions: number | null = null;
  private ready: Promise<void> | null = null;

  constructor(url: string = env.qdrantUrl, apiKey: string = env.qdrantApiKey) {
    this.client = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
      checkCompatibility: false,
    });
    this.collection = env.qdrantCollection;
  }

  /**
   * Lazily initialise the collection. Detects embedding dimensions on first call.
   */
  async ensureReady(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      this.dimensions = await getEmbeddingDimensions();
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === this.collection);
      if (!exists) {
        await this.client.createCollection(this.collection, {
          vectors: { size: this.dimensions, distance: 'Cosine' },
        });
      }
    })();
    return this.ready;
  }

  async upsertEvent(event: SecurityEvent, vector: number[]): Promise<void> {
    await this.ensureReady();
    if (this.dimensions && vector.length !== this.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dimensions}, got ${vector.length}`
      );
    }
    const pointId = stringToPointId(event.id);
    await this.client.upsert(this.collection, {
      points: [
        {
          id: pointId,
          vector,
          payload: {
            eventId: event.id,
            canonicalTitle: event.canonicalTitle,
            eventType: event.eventType,
            vendors: event.vendors,
            products: event.products,
            cveIds: event.cveIds,
            severity: event.severity,
            confidence: event.confidence,
            firstSeenAt: event.firstSeenAt,
            summary: event.summary,
          } satisfies SecurityEventPayload,
        },
      ],
    });
  }

  async findSimilar(
    vector: number[],
    options: { limit?: number; minScore?: number; excludeEventId?: string } = {}
  ): Promise<SimilarityMatch[]> {
    await this.ensureReady();
    const { limit = 5, minScore = 0, excludeEventId } = options;

    const filter = excludeEventId
      ? { must_not: [{ key: 'eventId', match: { value: excludeEventId } }] }
      : undefined;

    const results = await this.client.search(this.collection, {
      vector,
      limit,
      score_threshold: minScore > 0 ? minScore : undefined,
      filter,
      with_payload: true,
    });

    return results
      .filter((r) => r.payload !== null && r.payload !== undefined)
      .map((r) => ({
        eventId: (r.payload as unknown as SecurityEventPayload).eventId,
        score: r.score,
        payload: r.payload as unknown as SecurityEventPayload,
      }));
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Qdrant accepts string IDs only when they fit in a uint64. For our UUID-like event IDs,
 * hash to a numeric point ID to be safe.
 */
function stringToPointId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export const qdrantStore = new QdrantVectorStore();
