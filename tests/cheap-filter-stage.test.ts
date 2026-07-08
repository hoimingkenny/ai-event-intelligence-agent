import { describe, expect, it } from 'vitest';
import { runCheapFilterStage } from '../src/pipeline/filter-stage.js';
import { runExtractionStage } from '../src/pipeline/extraction-stage.js';
import type { Queryable } from '../src/db/repositories/types.js';

class CheapFilterDb implements Queryable {
  public readonly cheapFilterDecisions: string[] = [];
  public readonly statusUpdates: Array<{ id: string; status: string; error: string | null }> = [];

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
    if (sql.includes('WHERE processing_status = $1')) {
      return {
        rows: [
          articleRow('1', 'CyberArk PAS auth bypass exploited in attacks', 'Bleeping Computer'),
          articleRow('2', 'CVE-2026-12345 added to KEV catalog', 'CISA'),
          // Deliberately mentions no monitored vendor so the DROP path stays
          // stable regardless of config/monitored-vendors.json edits.
          articleRow('3', 'Contoso announces new feature release', 'General Business News'),
        ] as T[],
        rowCount: 3,
      };
    }

    if (sql.includes('SET cheap_filter_decision = $2')) {
      this.cheapFilterDecisions.push(String(params?.[1]));
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('SET processing_status = $2')) {
      this.statusUpdates.push({
        id: String(params?.[0]),
        status: String(params?.[1]),
        error: params?.[2] == null ? null : String(params[2]),
      });
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

class ExtractionPriorityDb implements Queryable {
  public readonly extractedIds: string[] = [];

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
    if (sql.includes("WHEN 'EXTRACTION_PENDING' THEN 0")) {
      return {
        rows: [
          articleRow('high', 'High priority article', 'Bleeping Computer', 'EXTRACTION_PENDING'),
          articleRow('low', 'Low priority article', 'Bleeping Computer', 'EXTRACTION_PENDING_LOW_PRIORITY'),
        ] as T[],
        rowCount: 2,
      };
    }

    if (sql.includes('SET raw_html = $2')) {
      this.extractedIds.push(String(params?.[0]));
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

function articleRow(id: string, title: string, sourceName: string, status = 'NEW') {
  return {
    id,
    feed_id: null,
    source_name: sourceName,
    title,
    canonical_url: `https://example.test/${id}`,
    url_hash: null,
    title_hash: null,
    content_hash: null,
    rss_summary: 'Summary',
    clean_text: null,
    published_at: new Date(),
    extraction_status: 'pending',
    extraction_method: null,
    extraction_error: null,
    processing_status: status,
  };
}

describe('cheap filter stage', () => {
  it('maps KEEP, MAYBE_KEEP, and DROP to article statuses and persists decisions', async () => {
    const db = new CheapFilterDb();

    const result = await runCheapFilterStage(db, { limit: 3 });

    expect(result).toEqual({
      reviewed: 3,
      extractionPending: 1,
      extractionPendingLowPriority: 1,
      ignored: 1,
    });
    expect(db.cheapFilterDecisions).toEqual(['KEEP', 'MAYBE_KEEP', 'DROP']);
    expect(db.statusUpdates.map((update) => update.status)).toEqual([
      'EXTRACTION_PENDING',
      'EXTRACTION_PENDING_LOW_PRIORITY',
      'IGNORED',
    ]);
    expect(db.statusUpdates[2].error).toContain('cheap_filter_insufficient_rss_signal');
  });
});

describe('extraction priority', () => {
  it('processes high-priority extraction candidates before low-priority candidates', async () => {
    const db = new ExtractionPriorityDb();

    const result = await runExtractionStage(db, {
      limit: 2,
      extractor: {
        extract: async ({ url }) => ({
          cleanText: `Extracted ${url}`,
          rawHtml: null,
          method: 'rss_summary',
          status: 'rss_only',
        }),
      },
    });

    expect(result).toEqual({ reviewed: 2, succeeded: 2, failed: 0 });
    expect(db.extractedIds).toEqual(['high', 'low']);
  });
});
