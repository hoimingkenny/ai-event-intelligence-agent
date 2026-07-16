import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';

const classifyCyberArticle = vi.fn();

vi.mock('../src/llm/cyber-classifier.js', () => ({ classifyCyberArticle }));

const { runArticleDigestStage } = await import('../src/pipeline/digest-stage.js');

function scriptedDb(
  handlers: Array<{ match: string; rows?: unknown[]; onQuery?: (params?: unknown[]) => void }>
): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const handler = handlers.find((h) => sql.includes(h.match));
      handler?.onQuery?.(params);
      return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows?.length ?? 0 };
    },
  };
}

const articleRow = {
  id: '42',
  feed_id: null,
  source_name: 'CISA',
  title: 'PAS advisory',
  canonical_url: 'https://example.test/42',
  url_hash: null,
  title_hash: null,
  content_hash: null,
  rss_summary: 'Summary',
  rss_categories: [],
  clean_text: 'CyberArk PAS vulnerability details.',
  published_at: new Date('2026-07-14T01:00:00Z'),
  extraction_status: 'http_success',
  extraction_method: 'http',
  extraction_error: null,
  processing_status: 'ENTITY_EXTRACTED',
};

const digestPayload = {
  cyberRelevant: true,
  eventType: 'vulnerability_disclosure',
  severity: 'high',
  urgency: 'P2',
  confidence: 0.88,
  vendorRoles: [{ vendor: 'CyberArk', role: 'affected', rationale: 'PAS mentioned.' }],
  affectedProducts: ['PAS'],
  cves: ['CVE-2026-9999'],
  reasoning: 'Clear vendor impact.',
};

describe('runArticleDigestStage', () => {
  beforeEach(() => {
    classifyCyberArticle.mockReset();
  });

  it('claims DIGESTING then persists DIGESTED on success in analyst-eval', async () => {
    classifyCyberArticle.mockResolvedValueOnce(digestPayload);

    const statusUpdates: string[] = [];
    const savedDigests: unknown[] = [];
    const audits: unknown[][] = [];

    const db = scriptedDb([
      { match: 'llm_article_digest IS NULL', rows: [articleRow] },
      {
        match: 'SET processing_status = $2',
        rows: [],
        onQuery: (params) => statusUpdates.push(String(params?.[1])),
      },
      {
        match: 'SET llm_article_digest',
        rows: [],
        onQuery: (params) => {
          savedDigests.push(params?.[1]);
          statusUpdates.push(String(params?.[2]));
        },
      },
      { match: 'INSERT INTO llm_audit_logs', rows: [], onQuery: (params) => audits.push(params ?? []) },
    ]);

    const result = await runArticleDigestStage(db, {
      limit: 1,
      profile: 'analyst-eval',
      includeLlm: true,
    });

    expect(result).toEqual({ reviewed: 1, digested: 1, skipped: 0, failed: 0 });
    expect(statusUpdates).toEqual(['DIGESTING', 'DIGESTED']);
    expect(JSON.parse(String(savedDigests[0]))).toMatchObject({ eventType: 'vulnerability_disclosure' });
    expect(audits[0]?.[2]).toBe('article_digest');
  });

  it('keeps ENTITY_EXTRACTED status when digest runs in full profile', async () => {
    classifyCyberArticle.mockResolvedValueOnce({
      ...digestPayload,
      eventType: 'active_exploitation',
      severity: 'critical',
      urgency: 'P1',
      confidence: 0.9,
      vendorRoles: [],
      affectedProducts: [],
      cves: [],
      reasoning: 'Exploitation reported.',
    });

    const statusUpdates: string[] = [];
    const db = scriptedDb([
      { match: 'llm_article_digest IS NULL', rows: [articleRow] },
      {
        match: 'SET processing_status = $2',
        rows: [],
        onQuery: (params) => statusUpdates.push(String(params?.[1])),
      },
      {
        match: 'SET llm_article_digest',
        rows: [],
        onQuery: (params) => statusUpdates.push(String(params?.[2])),
      },
      { match: 'INSERT INTO llm_audit_logs', rows: [] },
    ]);

    await runArticleDigestStage(db, { limit: 1, profile: 'full', includeLlm: true });

    expect(statusUpdates).toEqual(['DIGESTING', 'ENTITY_EXTRACTED']);
  });

  it('reverts to ENTITY_EXTRACTED when the LLM call fails', async () => {
    classifyCyberArticle.mockRejectedValueOnce(new Error('timeout'));

    const statusUpdates: string[] = [];
    const audits: unknown[][] = [];
    const db = scriptedDb([
      { match: 'llm_article_digest IS NULL', rows: [articleRow] },
      {
        match: 'SET processing_status = $2',
        rows: [],
        onQuery: (params) => statusUpdates.push(String(params?.[1])),
      },
      { match: 'INSERT INTO llm_audit_logs', rows: [], onQuery: (params) => audits.push(params ?? []) },
    ]);

    const result = await runArticleDigestStage(db, {
      limit: 1,
      profile: 'analyst-eval',
      includeLlm: true,
    });

    expect(result).toEqual({ reviewed: 1, digested: 0, skipped: 0, failed: 1 });
    expect(statusUpdates).toEqual(['DIGESTING', 'ENTITY_EXTRACTED']);
    expect(audits[0]?.[7]).toBe('error');
  });

  it('skips LLM calls when includeLlm is false', async () => {
    const db = scriptedDb([{ match: 'llm_article_digest IS NULL', rows: [articleRow] }]);

    const result = await runArticleDigestStage(db, { limit: 1, includeLlm: false });

    expect(result).toEqual({ reviewed: 1, digested: 0, skipped: 1, failed: 0 });
    expect(classifyCyberArticle).not.toHaveBeenCalled();
  });

  it('runs digests with bounded concurrency', async () => {
    const rows = [1, 2, 3, 4, 5].map((n) => ({ ...articleRow, id: String(n) }));
    let inFlight = 0;
    let maxInFlight = 0;

    classifyCyberArticle.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return {
        cyberRelevant: true,
        eventType: 'vulnerability_disclosure',
        severity: 'medium',
        urgency: 'P3',
        confidence: 0.7,
        vendorRoles: [],
        affectedProducts: [],
        cves: [],
        reasoning: 'ok',
      };
    });

    const db = scriptedDb([
      { match: 'llm_article_digest IS NULL', rows: rows },
      { match: 'SET processing_status = $2', rows: [] },
      { match: 'SET llm_article_digest', rows: [] },
      { match: 'INSERT INTO llm_audit_logs', rows: [] },
    ]);

    const result = await runArticleDigestStage(db, {
      limit: 5,
      profile: 'analyst-eval',
      includeLlm: true,
      concurrency: 2,
    });

    expect(result).toEqual({ reviewed: 5, digested: 5, skipped: 0, failed: 0 });
    expect(maxInFlight).toBe(2);
    expect(classifyCyberArticle).toHaveBeenCalledTimes(5);
  });
});
