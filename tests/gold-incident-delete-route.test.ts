import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { routeGroupingEvalRequest } from '../src/review/grouping/grouping-eval-routes.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

function makeReq(method: string, urlPath: string): IncomingMessage {
  const stream = Readable.from([]);
  return Object.assign(stream, {
    method,
    url: urlPath,
    headers: { host: 'localhost' },
  }) as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { _body: string; statusCode: number } {
  let body = '';
  let code = 200;
  const res = {
    get statusCode(): number {
      return code;
    },
    set statusCode(v: number) {
      code = v;
    },
    writeHead(status: number, _h: Record<string, string>) {
      code = status;
      return this;
    },
    end(chunk: string) {
      body = chunk;
      (this as unknown as { _body: string })._body = chunk;
      return this;
    },
  } as unknown as ServerResponse & { _body: string; statusCode: number };
  return res;
}

const SEED = JSON.stringify({
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  name: 'Demo',
  articles: [
    { articleId: 'a-1', url: 'https://x.test/a', title: 'A', sourceName: 'SW' },
    { articleId: 'b-1', url: 'https://x.test/b', title: 'B', sourceName: 'BC' },
  ],
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
});

describe('DELETE /api/grouping-eval/incidents/:id', () => {
  it('removes a gold incident from the JSONL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'delete-incident-'));
    const path = join(dir, 'gold.jsonl');
    await writeFile(path, SEED + '\n', 'utf8');

    const req = makeReq('DELETE', '/api/grouping-eval/incidents/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    const res = makeRes();
    const handled = await routeGroupingEvalRequest(req, res, {
      pairDatasetPath: 'unused',
      goldIncidentsPath: path,
      db: null,
    });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res._body)).toEqual({ deleted: true });

    const getRes = makeRes();
    await routeGroupingEvalRequest(makeReq('GET', '/api/grouping-eval/incidents'), getRes, {
      pairDatasetPath: 'unused',
      goldIncidentsPath: path,
      db: null,
    });
    expect(JSON.parse(getRes._body)).toEqual({ incidents: [] });
  });

  it('returns 404 when the id does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'delete-incident-'));
    const path = join(dir, 'gold.jsonl');
    await writeFile(path, SEED + '\n', 'utf8');

    const req = makeReq('DELETE', '/api/grouping-eval/incidents/ghost-id');
    const res = makeRes();
    await routeGroupingEvalRequest(req, res, {
      pairDatasetPath: 'unused',
      goldIncidentsPath: path,
      db: null,
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res._body)).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});