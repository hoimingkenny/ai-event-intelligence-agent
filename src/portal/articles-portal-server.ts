import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { Queryable } from '../db/repositories/types.js';
import {
  loadArticleCleanText,
  loadArticleDetail,
  loadArticlesOverview,
  type ArticlesQuery,
} from './articles-portal.js';
import { renderPortalApp } from './articles-portal-view.js';

/**
 * Article monitoring portal — read-only HTTP surface over the pipeline's
 * article state. Localhost-bound by default; add auth before exposing it
 * (Pillar 5). All responses are read-only; no mutation endpoints.
 */
export interface ArticlesPortalOptions {
  host?: string;
  port?: number;
}

export async function startArticlesPortal(
  db: Queryable,
  options: ArticlesPortalOptions = {}
): Promise<http.Server> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4322;
  const server = createArticlesPortal(db);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
}

export function createArticlesPortal(db: Queryable): http.Server {
  return http.createServer(async (req, res) => {
    try {
      await route(db, req, res);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}

async function route(db: Queryable, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (req.method !== 'GET') {
    sendJson(res, { error: 'method not allowed' }, 405);
    return;
  }

  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderPortalApp());
    return;
  }

  if (path === '/api/articles') {
    const query: ArticlesQuery = {
      status: url.searchParams.get('status'),
      source: url.searchParams.get('source'),
      search: url.searchParams.get('q'),
      limit: numberParam(url, 'limit'),
      offset: numberParam(url, 'offset'),
      sort: sortParam(url),
    };
    sendJson(res, await loadArticlesOverview(db, query));
    return;
  }

  const detailMatch = path.match(/^\/api\/articles\/(\d+)$/);
  if (detailMatch) {
    const detail = await loadArticleDetail(db, detailMatch[1]);
    if (!detail) return sendJson(res, { error: 'not found' }, 404);
    return sendJson(res, detail);
  }

  // Extracted-text reader preview, rendered as a safe standalone HTML doc.
  const previewMatch = path.match(/^\/api\/articles\/(\d+)\/preview$/);
  if (previewMatch) {
    const article = await loadArticleCleanText(db, previewMatch[1]);
    if (!article) return sendJson(res, { error: 'not found' }, 404);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderReaderPreview(article.title, article.cleanText));
    return;
  }

  sendJson(res, { error: 'not found' }, 404);
}

function renderReaderPreview(title: string | null, cleanText: string | null): string {
  const paragraphs = (cleanText ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:16px/1.6 -apple-system,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#1a1a1a}
    h1{font-size:22px;line-height:1.3} p{margin:0 0 12px} .empty{color:#999;font-style:italic}
  </style></head><body>
    <h1>${escapeHtml(title ?? '(untitled)')}</h1>
    ${paragraphs || '<p class="empty">No extracted text.</p>'}
  </body></html>`;
}

function numberParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function sortParam(url: URL): ArticlesQuery['sort'] {
  const s = url.searchParams.get('sort');
  return s === 'quality_asc' || s === 'recall_asc' || s === 'vendor_desc' || s === 'recent'
    ? s
    : undefined;
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
