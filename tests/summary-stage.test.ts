import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import { runSummaryStage } from '../src/pipeline/summary-stage.js';

function scriptedDb(handlers: Array<{ match: string; rows: unknown[]; onQuery?: (params?: unknown[]) => void }>): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const handler = handlers.find((h) => sql.includes(h.match));
      handler?.onQuery?.(params);
      return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows.length ?? 0 };
    },
  } as Queryable;
}

const eventRow = {
  id: '10',
  grouping_key: 'cve:cve-2026-1234',
  first_seen_at: new Date('2026-07-01T08:00:00Z'),
  event_title: 'Draft title',
  event_summary: 'Draft summary',
  event_status: 'open',
  severity: 'high',
  urgency: 'P2',
  confidence: '0.7',
  affected_vendors: ['Vendor'],
  affected_products: ['VPN'],
  cves: ['CVE-2026-1234'],
  attack_types: ['active_exploitation'],
  summary_stale: true,
};

const articleRow = {
  id: '1',
  feed_id: null,
  source_name: 'Source',
  title: 'Vendor VPN exploited',
  canonical_url: 'https://example.test/a',
  url_hash: null,
  title_hash: null,
  content_hash: null,
  rss_summary: 'Attackers exploit Vendor VPN.',
  rss_categories: [],
  clean_text: 'Attackers exploit CVE-2026-1234 in Vendor VPN.',
  published_at: new Date('2026-07-01T08:00:00Z'),
  extraction_status: 'http_success',
  extraction_method: 'http',
  extraction_error: null,
  processing_status: 'CLASSIFIED',
};

describe('runSummaryStage', () => {
  it('summarizes stale or missing-summary events and writes an audit row', async () => {
    const saved: unknown[] = [];
    const audits: unknown[][] = [];
    const db = scriptedDb([
      { match: 'llm_summary IS NULL OR summary_stale', rows: [eventRow] },
      { match: 'FROM event_articles ea', rows: [articleRow] },
      { match: 'SET llm_summary', rows: [], onQuery: (params) => saved.push(params?.[1]) },
      { match: 'INSERT INTO llm_audit_logs', rows: [], onQuery: (params) => audits.push(params ?? []) },
    ]);

    const result = await runSummaryStage(db, {
      summarizer: async () => ({
        title: 'Vendor VPN exploitation is active',
        summary: 'Attackers are exploiting Vendor VPN; review exposure.',
        severity: 'critical',
        urgency: 'P1',
        confidence: 0.91,
        keyFacts: ['CVE-2026-1234 is referenced.'],
        recommendedActions: ['Check affected VPN exposure.'],
      }),
    });

    expect(result).toEqual({ reviewed: 1, summarized: 1, failed: 0 });
    expect(JSON.parse(String(saved[0]))).toMatchObject({ title: 'Vendor VPN exploitation is active' });
    expect(audits[0]?.[2]).toBe('event_summary');
    expect(audits[0]?.[7]).toBe('valid');
  });

  it('keeps failed events retryable and records an error audit row', async () => {
    const audits: unknown[][] = [];
    const db = scriptedDb([
      { match: 'llm_summary IS NULL OR summary_stale', rows: [eventRow] },
      { match: 'FROM event_articles ea', rows: [articleRow] },
      { match: 'INSERT INTO llm_audit_logs', rows: [], onQuery: (params) => audits.push(params ?? []) },
    ]);

    const result = await runSummaryStage(db, {
      summarizer: async () => {
        throw new Error('model unavailable');
      },
    });

    expect(result).toEqual({ reviewed: 1, summarized: 0, failed: 1 });
    expect(audits[0]?.[2]).toBe('event_summary');
    expect(audits[0]?.[7]).toBe('error');
    expect(audits[0]?.[8]).toBe('model unavailable');
  });
});
