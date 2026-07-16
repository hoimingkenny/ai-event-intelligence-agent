import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import type { VendorProduct } from '../src/types/domain.js';

const digestArticleAgainstInventory = vi.fn();

vi.mock('../src/llm/article-digest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm/article-digest.js')>();
  return {
    ...actual,
    digestArticleAgainstInventory,
  };
});

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

const inventory: VendorProduct[] = [
  {
    id: 'vp_cyberark_pas',
    vendor: 'CyberArk',
    product: 'Privileged Access Security',
    aliases: ['PAS'],
    criticality: 'critical',
    inProduction: true,
    newsVolume: 'quiet',
  },
];

const digestPayload = {
  relatedToMonitoredInventory: true,
  incidentSummary: 'PAS vulnerability disclosure.',
  cves: ['CVE-2026-9999'],
  matchedVendors: ['CyberArk'],
  matchedProducts: ['Privileged Access Security'],
  confidence: 0.88,
  reasoning: 'Clear product advisory.',
};

describe('runArticleDigestStage', () => {
  beforeEach(() => {
    digestArticleAgainstInventory.mockReset();
  });

  it('claims DIGESTING then persists DIGESTED on success in analyst-eval', async () => {
    digestArticleAgainstInventory.mockResolvedValueOnce(digestPayload);

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
      inventory,
    });

    expect(result).toEqual({ reviewed: 1, digested: 1, skipped: 0, failed: 0 });
    expect(statusUpdates).toEqual(['DIGESTING', 'DIGESTED']);
    expect(JSON.parse(String(savedDigests[0]))).toMatchObject({
      relatedToMonitoredInventory: true,
      incidentSummary: 'PAS vulnerability disclosure.',
    });
    expect(digestArticleAgainstInventory).toHaveBeenCalledWith(
      expect.objectContaining({ id: '42' }),
      inventory
    );
    expect(audits[0]?.[2]).toBe('article_digest');
    expect(audits[0]?.[4]).toBe('article-digest-v1');
  });

  it('keeps ENTITY_EXTRACTED status when digest runs in full profile', async () => {
    digestArticleAgainstInventory.mockResolvedValueOnce(digestPayload);

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

    await runArticleDigestStage(db, {
      limit: 1,
      profile: 'full',
      includeLlm: true,
      inventory,
    });

    expect(statusUpdates).toEqual(['DIGESTING', 'ENTITY_EXTRACTED']);
  });

  it('reverts to ENTITY_EXTRACTED when the LLM call fails', async () => {
    digestArticleAgainstInventory.mockRejectedValueOnce(new Error('timeout'));

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
      inventory,
    });

    expect(result).toEqual({ reviewed: 1, digested: 0, skipped: 0, failed: 1 });
    expect(statusUpdates).toEqual(['DIGESTING', 'ENTITY_EXTRACTED']);
    expect(audits[0]?.[7]).toBe('error');
  });

  it('skips LLM calls when includeLlm is false', async () => {
    const db = scriptedDb([{ match: 'llm_article_digest IS NULL', rows: [articleRow] }]);

    const result = await runArticleDigestStage(db, {
      limit: 1,
      includeLlm: false,
      inventory,
    });

    expect(result).toEqual({ reviewed: 1, digested: 0, skipped: 1, failed: 0 });
    expect(digestArticleAgainstInventory).not.toHaveBeenCalled();
  });

  it('runs digests with bounded concurrency', async () => {
    const rows = [1, 2, 3, 4, 5].map((n) => ({ ...articleRow, id: String(n) }));
    let inFlight = 0;
    let maxInFlight = 0;

    digestArticleAgainstInventory.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return digestPayload;
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
      inventory,
    });

    expect(result).toEqual({ reviewed: 5, digested: 5, skipped: 0, failed: 0 });
    expect(maxInFlight).toBe(2);
    expect(digestArticleAgainstInventory).toHaveBeenCalledTimes(5);
  });
});
