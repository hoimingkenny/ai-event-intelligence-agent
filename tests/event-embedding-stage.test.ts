import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

class FakeDb implements Queryable {
  public readonly saved: Array<{ eventId: string; vector: string; model: string }> = [];
  public readonly failures: string[] = [];

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
    if (sql.includes('FROM cyber_events') && sql.includes('event_embedding IS NULL')) {
      return { rows: [eventRow('1'), eventRow('2')] as T[], rowCount: 2 };
    }
    if (sql.includes('FROM event_articles') || sql.includes('JOIN articles')) {
      const eventId = String(params?.[0]);
      return {
        rows: [
          {
            id: `article-${eventId}`,
            feed_id: null,
            source_name: 'Source',
            title: 'Title',
            canonical_url: `https://example.test/${eventId}`,
            url_hash: null,
            title_hash: null,
            content_hash: null,
            rss_summary: 'summary',
            rss_categories: [],
            clean_text: 'body',
            published_at: new Date(),
            extraction_status: 'http_success',
            extraction_method: 'http',
            extraction_error: null,
            processing_status: 'GROUPED',
          },
        ] as T[],
        rowCount: 1,
      };
    }
    if (sql.includes('SELECT embedding::text') && sql.includes('embedding_model')) {
      return {
        rows: [{ embedding: '[0.1,0.2,0.3]' }] as T[],
        rowCount: 1,
      };
    }
    if (sql.includes('SET event_embedding = $2::vector')) {
      this.saved.push({
        eventId: String(params?.[0]),
        vector: String(params?.[1]),
        model: String(params?.[2]),
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('event_embedding_retry_count = event_embedding_retry_count + 1')) {
      this.failures.push(String(params?.[0]));
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

function eventRow(id: string) {
  return {
    id,
    event_title: `Event ${id}`,
    event_summary: 'Summary',
    event_status: 'open',
    severity: 'medium',
    urgency: 'P3',
    confidence: '0.6',
    affected_vendors: [],
    affected_products: [],
    cves: [],
    attack_types: [],
    summary_stale: false,
  };
}

describe('runEventEmbeddingStage', () => {
  it('copies current-model article embeddings onto events missing vectors', async () => {
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.OLLAMA_EMBEDDING_MODEL = 'qwen3-embedding:4b';
    process.env.EMBEDDING_DIMENSIONS = '1536';

    const db = new FakeDb();
    const { runEventEmbeddingStage } = await import('../src/pipeline/event-embedding-stage.js');
    const result = await runEventEmbeddingStage(db, { limit: 10 });

    expect(result).toEqual({ reviewed: 2, embedded: 2, skipped: 0, failed: 0 });
    expect(db.saved).toEqual([
      { eventId: '1', vector: '[0.1,0.2,0.3]', model: 'qwen3-embedding:4b' },
      { eventId: '2', vector: '[0.1,0.2,0.3]', model: 'qwen3-embedding:4b' },
    ]);
    expect(db.failures).toEqual([]);
  });
});
