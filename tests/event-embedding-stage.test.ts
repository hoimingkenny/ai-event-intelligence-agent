import { describe, expect, it } from 'vitest';
import { runEventEmbeddingStage } from '../src/pipeline/event-embedding-stage.js';
import type { Queryable } from '../src/db/repositories/types.js';

class FakeDb implements Queryable {
  public readonly savedVectors: string[] = [];

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
    if (sql.includes('FROM cyber_events') && sql.includes('event_embedding IS NULL')) {
      return {
        rows: [eventRow('1'), eventRow('2')] as T[],
        rowCount: 2,
      };
    }

    if (sql.includes('SET event_embedding = $2::vector')) {
      this.savedVectors.push(String(params?.[1]));
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

function eventRow(id: string) {
  return {
    id,
    event_title: `Vendor VPN zero day exploited ${id}`,
    event_summary: 'Active exploitation is underway.',
    event_status: 'open',
    severity: 'critical',
    urgency: 'immediate',
    confidence: '0.95',
    affected_vendors: ['Vendor'],
    affected_products: ['VPN'],
    cves: ['CVE-2026-1234'],
    attack_types: ['active_exploitation'],
  };
}

describe('runEventEmbeddingStage', () => {
  it('embeds open events in one batch request', async () => {
    const db = new FakeDb();
    const seenBatches: string[][] = [];
    const result = await runEventEmbeddingStage(db, {
      client: {
        embedDocument: async () => {
          throw new Error('single embedding should not be used');
        },
        embedDocuments: async (texts) => {
          seenBatches.push(texts);
          return [
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
          ];
        },
      },
      batchSize: 10,
      minTextLength: 10,
    });

    expect(result).toEqual({ reviewed: 2, embedded: 2, skipped: 0, failed: 0 });
    expect(seenBatches).toHaveLength(1);
    expect(seenBatches[0]).toHaveLength(2);
    expect(db.savedVectors).toEqual(['[0.1,0.2,0.3]', '[0.4,0.5,0.6]']);
  });
});
