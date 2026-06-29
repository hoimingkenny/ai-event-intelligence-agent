import { describe, expect, it } from 'vitest';
import { runEventEmbeddingStage } from '../src/pipeline/event-embedding-stage.js';
import type { Queryable } from '../src/db/repositories/types.js';

class FakeDb implements Queryable {
  public savedVector: string | null = null;

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
    if (sql.includes('FROM cyber_events') && sql.includes('event_embedding IS NULL')) {
      return {
        rows: [
          {
            id: '1',
            event_title: 'Vendor VPN zero day exploited',
            event_summary: 'Active exploitation is underway.',
            event_status: 'open',
            severity: 'critical',
            urgency: 'immediate',
            confidence: '0.95',
            affected_vendors: ['Vendor'],
            affected_products: ['VPN'],
            cves: ['CVE-2026-1234'],
            attack_types: ['active_exploitation'],
          },
        ] as T[],
        rowCount: 1,
      };
    }

    if (sql.includes('SET event_embedding = $2::vector')) {
      this.savedVector = String(params?.[1]);
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

describe('runEventEmbeddingStage', () => {
  it('embeds open events with source articles', async () => {
    const db = new FakeDb();
    const result = await runEventEmbeddingStage(db, {
      client: { embedDocument: async () => [0.1, 0.2, 0.3] },
      minTextLength: 10,
    });

    expect(result).toEqual({ reviewed: 1, embedded: 1, skipped: 0, failed: 0 });
    expect(db.savedVector).toBe('[0.1,0.2,0.3]');
  });
});
