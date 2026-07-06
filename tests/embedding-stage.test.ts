import { describe, expect, it } from 'vitest';
import { vectorToSqlLiteral } from '../src/db/repositories/article.repository.js';
import { buildArticleEmbeddingText, buildEventEmbeddingText } from '../src/embedding/embedding-client.js';
import { runEmbeddingStage } from '../src/pipeline/embedding-stage.js';
import type { Queryable } from '../src/db/repositories/types.js';

class FakeEmbeddingDb implements Queryable {
  public readonly savedArticleIds: string[] = [];
  public readonly ignoredArticleIds: string[] = [];

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
    if (sql.includes('FROM articles') && sql.includes('processing_status = ANY')) {
      return {
        rows: [
          articleRow('1', 'ENTITY_EXTRACTED'),
          articleRow('2', 'EMBEDDING_PENDING'),
        ] as T[],
        rowCount: 2,
      };
    }

    if (sql.includes('SET embedding = $2::vector')) {
      this.savedArticleIds.push(String(params?.[0]));
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("processing_status = $2")) {
      this.ignoredArticleIds.push(String(params?.[0]));
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

function articleRow(id: string, status: string) {
  return {
    id,
    feed_id: null,
    source_name: 'Source',
    title: `Article ${id}`,
    canonical_url: `https://example.test/${id}`,
    url_hash: null,
    title_hash: null,
    content_hash: null,
    rss_summary: 'Summary with enough content for embedding.',
    clean_text: 'A'.repeat(200),
    published_at: new Date(),
    extraction_status: 'http_success',
    extraction_method: 'http',
    extraction_error: null,
    processing_status: status,
  };
}

describe('embedding helpers', () => {
  it('serializes vectors for pgvector parameters', () => {
    expect(vectorToSqlLiteral([0.1, -2, 3])).toBe('[0.1,-2,3]');
  });

  it('builds bounded embedding text from article fields', () => {
    const text = buildArticleEmbeddingText({
      title: 'Vendor advisory',
      rssSummary: 'Summary',
      cleanText: 'A'.repeat(13000),
    });

    expect(text.startsWith('Vendor advisory\nSummary\n')).toBe(true);
    expect(text.length).toBe(12000);
  });

  it('builds bounded embedding text from event fields', () => {
    const text = buildEventEmbeddingText({
      eventTitle: 'Active exploitation of Vendor VPN',
      eventSummary: 'Attackers are exploiting CVE-2026-1234.',
      severity: 'critical',
      urgency: 'immediate',
      affectedVendors: ['Vendor'],
      affectedProducts: ['VPN'],
      cves: ['CVE-2026-1234'],
      attackTypes: ['active_exploitation'],
    });

    expect(text).toContain('Active exploitation of Vendor VPN');
    expect(text).toContain('Vendors: Vendor');
    expect(text).toContain('CVEs: CVE-2026-1234');
  });

  it('retries articles left pending after a previous embedding failure', async () => {
    const db = new FakeEmbeddingDb();
    const result = await runEmbeddingStage(db, {
      client: {
        embedDocument: async () => [0.1, 0.2, 0.3],
        embedDocuments: async () => [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ],
      },
      minTextLength: 10,
    });

    expect(result).toEqual({ reviewed: 2, embedded: 2, skipped: 0, failed: 0 });
    expect(db.savedArticleIds).toEqual(['1', '2']);
  });

  it('embeds eligible articles in one batch request', async () => {
    const db = new FakeEmbeddingDb();
    const seenBatches: string[][] = [];

    const result = await runEmbeddingStage(db, {
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
    expect(db.savedArticleIds).toEqual(['1', '2']);
  });
});
