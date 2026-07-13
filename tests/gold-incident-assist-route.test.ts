import { describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { routeGroupingEvalRequest } from '../src/review/grouping/grouping-eval-routes.js';
import type { Queryable } from '../src/db/repositories/types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

interface StubRow {
  id: string;
  canonical_url: string | null;
  title: string | null;
  source_name: string | null;
  clean_text: string | null;
}

function stubDb(rows: StubRow[]): Queryable {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM articles\s+WHERE id = ANY/i.test(sql)) {
        const ids = (params?.[0] as unknown[]) ?? [];
        const wanted = new Set(ids.map((id) => String(id)));
        const out = rows.filter((row) => wanted.has(String(row.id)));
        return { rows: out, rowCount: out.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

function makeReq(method: string, urlPath: string, body: unknown): IncomingMessage {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const stream = Readable.from([raw]);
  return Object.assign(stream, {
    method,
    url: urlPath,
    headers: { host: 'localhost' },
  }) as unknown as IncomingMessage;
}

async function send(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
  req: IncomingMessage,
  res: ServerResponse
): Promise<{ status: number; body: unknown }> {
  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(((res as unknown as { _body?: string })._body ?? '')) };
}

function makeRes(): ServerResponse {
  let body = '';
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    writeHead(status: number, h: Record<string, string>) {
      this.statusCode = status;
      Object.assign(headers, h);
      return this;
    },
    end(chunk: string) {
      body = chunk;
      (this as unknown as { _body: string })._body = chunk;
      return this;
    },
    get body(): string {
      return body;
    },
    get headers(): Record<string, string> {
      return headers;
    },
  } as unknown as ServerResponse & { _body: string };
  return res;
}

describe('POST /api/grouping-eval/assist', () => {
  it('returns a draft when articles are loaded and proposer succeeds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assist-route-'));
    const db = stubDb([
      { id: 1, canonical_url: 'https://x.test/a', title: 'SharePoint RCE', source_name: 'SecurityWeek', clean_text: 'body a' },
      { id: 2, canonical_url: 'https://x.test/b', title: 'SharePoint patch', source_name: 'Bleeping Computer', clean_text: 'body b' },
    ]);
    const proposeAssist = vi.fn().mockResolvedValue({
      recommendation: 'same_event',
      confidence: 0.9,
      rationale: 'aligned',
      suggestedName: 'SharePoint 202505',
      briefs: [
        { articleId: '1', url: 'https://x.test/a', title: 'SharePoint RCE', sourceName: 'SecurityWeek', brief: ['bullet'] },
        { articleId: '2', url: 'https://x.test/b', title: 'SharePoint patch', sourceName: 'Bleeping Computer', brief: ['bullet'] },
      ],
    });

    const req = makeReq('POST', '/api/grouping-eval/assist', { articleIds: ['1', '2'] });
    const res = makeRes();
    const handled = await routeGroupingEvalRequest(req, res, {
      pairDatasetPath: join(dir, 'pairs.jsonl'),
      goldIncidentsPath: join(dir, 'gold.jsonl'),
      db,
      proposeAssist,
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse((res as unknown as { _body: string })._body);
    expect((body as { draft: { recommendation: string } }).draft.recommendation).toBe('same_event');
    expect(proposeAssist).toHaveBeenCalledTimes(1);
    expect(proposeAssist.mock.calls[0][0].map((a: { articleId: number }) => String(a.articleId))).toEqual(['1', '2']);
  });

  it('returns 400 when too few ids', async () => {
    const db = stubDb([
      { id: 'a-1', canonical_url: 'https://x.test/a', title: 't', source_name: 's', clean_text: 'body' },
    ]);
    const proposeAssist = vi.fn();
    const req = makeReq('POST', '/api/grouping-eval/assist', { articleIds: ['a-1'] });
    const res = makeRes();
    await routeGroupingEvalRequest(req, res, {
      pairDatasetPath: 'unused',
      goldIncidentsPath: 'unused',
      db,
      proposeAssist,
    });
    const body = JSON.parse((res as unknown as { _body: string })._body);
    expect(res.statusCode).toBe(400);
    expect(['VALIDATION_ERROR', 'ARTICLE_COUNT']).toContain(
      (body as { error: { code: string } }).error.code
    );
    expect(proposeAssist).not.toHaveBeenCalled();
  });

  it('returns 400 with MISSING_CLEAN_TEXT when an article has no body', async () => {
    const db = stubDb([
      { id: 1, canonical_url: 'https://x.test/a', title: 't', source_name: 's', clean_text: 'body' },
      { id: 2, canonical_url: 'https://x.test/b', title: 't', source_name: 's', clean_text: null },
    ]);
    const proposeAssist = vi.fn();
    const req = makeReq('POST', '/api/grouping-eval/assist', { articleIds: ['1', '2'] });
    const res = makeRes();
    await routeGroupingEvalRequest(req, res, {
      pairDatasetPath: 'unused',
      goldIncidentsPath: 'unused',
      db,
      proposeAssist,
    });
    const body = JSON.parse((res as unknown as { _body: string })._body);
    expect(res.statusCode).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe('MISSING_CLEAN_TEXT');
    expect(proposeAssist).not.toHaveBeenCalled();
  });

  it('returns 404 ARTICLES_NOT_FOUND when ids are missing', async () => {
    const db = stubDb([
      { id: 1, canonical_url: 'https://x.test/a', title: 't', source_name: 's', clean_text: 'body' },
    ]);
    const req = makeReq('POST', '/api/grouping-eval/assist', { articleIds: ['1', '9999'] });
    const res = makeRes();
    await routeGroupingEvalRequest(req, res, {
      pairDatasetPath: 'unused',
      goldIncidentsPath: 'unused',
      db,
    });
    const body = JSON.parse((res as unknown as { _body: string })._body);
    expect(res.statusCode).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe('ARTICLES_NOT_FOUND');
  });
});