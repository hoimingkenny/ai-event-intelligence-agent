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

describe('runArticleDigestStage', () => {
  beforeEach(() => {
    classifyCyberArticle.mockReset();
  });

  it('persists digest and audit rows with DIGESTED terminal status in analyst-eval', async () => {
    const digest = {
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
    classifyCyberArticle.mockResolvedValueOnce(digest);

    const savedDigests: unknown[] = [];
    const terminalStatuses: string[] = [];
    const audits: unknown[][] = [];

    const db = scriptedDb([
      { match: 'llm_article_digest IS NULL', rows: [articleRow] },
      {
        match: 'SET llm_article_digest',
        rows: [],
        onQuery: (params) => {
          savedDigests.push(params?.[1]);
          terminalStatuses.push(String(params?.[2]));
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
    expect(JSON.parse(String(savedDigests[0]))).toMatchObject({ eventType: 'vulnerability_disclosure' });
    expect(terminalStatuses).toEqual(['DIGESTED']);
    expect(audits[0]?.[2]).toBe('article_digest');
    expect(audits[0]?.[7]).toBe('valid');
  });

  it('keeps ENTITY_EXTRACTED status when digest runs in full profile', async () => {
    classifyCyberArticle.mockResolvedValueOnce({
      cyberRelevant: true,
      eventType: 'active_exploitation',
      severity: 'critical',
      urgency: 'P1',
      confidence: 0.9,
      vendorRoles: [],
      affectedProducts: [],
      cves: [],
      reasoning: 'Exploitation reported.',
    });

    const terminalStatuses: string[] = [];
    const db = scriptedDb([
      { match: 'llm_article_digest IS NULL', rows: [articleRow] },
      {
        match: 'SET llm_article_digest',
        rows: [],
        onQuery: (params) => terminalStatuses.push(String(params?.[2])),
      },
      { match: 'INSERT INTO llm_audit_logs', rows: [] },
    ]);

    await runArticleDigestStage(db, { limit: 1, profile: 'full', includeLlm: true });

    expect(terminalStatuses).toEqual(['ENTITY_EXTRACTED']);
  });

  it('skips LLM calls when includeLlm is false', async () => {
    const db = scriptedDb([{ match: 'llm_article_digest IS NULL', rows: [articleRow] }]);

    const result = await runArticleDigestStage(db, { limit: 1, includeLlm: false });

    expect(result).toEqual({ reviewed: 1, digested: 0, skipped: 1, failed: 0 });
    expect(classifyCyberArticle).not.toHaveBeenCalled();
  });
});
