import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { URL } from 'node:url';
import { z, ZodError } from 'zod';
import { loadCheapFilterDataset, normalizeDatasetRecord } from '../utils/datasetLoader.js';
import { loadCandidates } from '../utils/candidateStore.js';
import { evaluateCheapFilterDataset, DEFAULT_CHEAP_FILTER_THRESHOLDS } from '../utils/metrics.js';
import { HUMAN_LABELS } from '../types/cheap-filter-eval.types.js';
import { inferSourceTier, type SourceTier } from '../../src/pipeline/filter-stage.js';
import type { Queryable } from '../../src/db/repositories/types.js';
import { renderEvalReviewApp } from './eval-review-page.js';

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_DECISION_LIMIT = 200;

export interface EvalReviewServerOptions {
  datasetPath: string;
  candidatesPath: string;
  host?: string;
  port?: number;
  /** Optional Postgres connection; enables the live filter-decisions tab. */
  db?: Queryable | null;
}

const LabelSubmissionSchema = z.object({
  candidateId: z.string().min(1),
  humanLabel: z.enum(HUMAN_LABELS),
  humanReason: z.string().trim().min(3, 'humanReason must explain the judgement (min 3 characters).'),
});

const ArticleLabelSubmissionSchema = z.object({
  articleId: z.string().min(1),
  humanLabel: z.enum(HUMAN_LABELS),
  humanReason: z.string().trim().min(3, 'humanReason must explain the judgement (min 3 characters).'),
});

export interface FilterDecisionArticle {
  articleId: string;
  sourceName: string;
  sourceTier: SourceTier;
  url: string;
  title: string;
  rssSummary: string | null;
  rssCategories: string[];
  publishedAt: string | null;
  processingStatus: string;
  decision: string;
  score: number | null;
  reasons: string[];
  blockingReasons: string[];
  matchedSignals: unknown;
}

interface FilterDecisionRow {
  id: string;
  source_name: string | null;
  canonical_url: string | null;
  title: string | null;
  rss_summary: string | null;
  rss_categories: string[] | null;
  published_at: Date | null;
  processing_status: string;
  cheap_filter_decision: string;
  cheap_filter_score: number | string | null;
  cheap_filter_reasons: string[] | null;
  cheap_filter_blocking_reasons: string[] | null;
  cheap_filter_matched_signals: unknown;
}

async function listFilterDecisions(
  db: Queryable,
  decision: string | null,
  limit: number
): Promise<FilterDecisionArticle[]> {
  const filter = decision && decision !== 'ALL' ? 'AND cheap_filter_decision = $2' : '';
  const params: unknown[] = decision && decision !== 'ALL' ? [limit, decision] : [limit];
  const result = await db.query<FilterDecisionRow>(
    `
      SELECT id, source_name, canonical_url, title, rss_summary, rss_categories,
             published_at, processing_status, cheap_filter_decision, cheap_filter_score,
             cheap_filter_reasons, cheap_filter_blocking_reasons, cheap_filter_matched_signals
      FROM articles
      WHERE cheap_filter_decision IS NOT NULL
        AND canonical_url IS NOT NULL AND title IS NOT NULL
        ${filter}
      ORDER BY COALESCE(published_at, created_at) DESC
      LIMIT $1
    `,
    params
  );
  return result.rows.map(mapDecisionRow);
}

function mapDecisionRow(row: FilterDecisionRow): FilterDecisionArticle {
  return {
    articleId: row.id,
    sourceName: row.source_name ?? 'unknown',
    sourceTier: inferSourceTier(row.source_name),
    url: row.canonical_url as string,
    title: row.title as string,
    rssSummary: row.rss_summary,
    rssCategories: row.rss_categories ?? [],
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    processingStatus: row.processing_status,
    decision: row.cheap_filter_decision,
    score: row.cheap_filter_score == null ? null : Number(row.cheap_filter_score),
    reasons: row.cheap_filter_reasons ?? [],
    blockingReasons: row.cheap_filter_blocking_reasons ?? [],
    matchedSignals: row.cheap_filter_matched_signals,
  };
}

async function summarizeFilterDecisions(db: Queryable): Promise<Record<string, number>> {
  const result = await db.query<{ cheap_filter_decision: string; count: string }>(
    `
      SELECT cheap_filter_decision, COUNT(*)::text AS count
      FROM articles
      WHERE cheap_filter_decision IS NOT NULL
      GROUP BY cheap_filter_decision
    `
  );
  const summary: Record<string, number> = { KEEP: 0, MAYBE_KEEP: 0, DROP: 0 };
  for (const row of result.rows) summary[row.cheap_filter_decision] = Number(row.count);
  return summary;
}

async function appendLabelFromArticle(
  options: EvalReviewServerOptions,
  db: Queryable,
  input: z.infer<typeof ArticleLabelSubmissionSchema>
): Promise<unknown> {
  const articles = await listFilterDecisionById(db, input.articleId);
  if (!articles) {
    throw new NotFoundError(`Article ${input.articleId} not found or has no filter decision.`);
  }
  const samples = await loadDatasetOrEmpty(options.datasetPath);
  if (samples.some((sample) => sample.url === articles.url)) {
    throw new ConflictError(`Article ${input.articleId} is already labeled in the dataset.`);
  }

  const record = {
    sourceName: articles.sourceName,
    sourceTier: articles.sourceTier,
    url: articles.url,
    title: articles.title,
    rssSummary: articles.rssSummary,
    rssCategories: articles.rssCategories,
    publishedAt: articles.publishedAt,
    humanLabel: input.humanLabel,
    humanReason: input.humanReason,
  };
  const sample = normalizeDatasetRecord(record);

  await mkdir(dirname(options.datasetPath), { recursive: true });
  await appendFile(options.datasetPath, `${JSON.stringify(record)}\n`);
  return sample;
}

async function listFilterDecisionById(db: Queryable, articleId: string): Promise<FilterDecisionArticle | null> {
  const result = await db.query<FilterDecisionRow>(
    `
      SELECT id, source_name, canonical_url, title, rss_summary, rss_categories,
             published_at, processing_status, cheap_filter_decision, cheap_filter_score,
             cheap_filter_reasons, cheap_filter_blocking_reasons, cheap_filter_matched_signals
      FROM articles
      WHERE id = $1 AND cheap_filter_decision IS NOT NULL
        AND canonical_url IS NOT NULL AND title IS NOT NULL
    `,
    [articleId]
  );
  const row = result.rows[0];
  return row ? mapDecisionRow(row) : null;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(MAX_DECISION_LIMIT, Math.trunc(limit)));
}

export async function startEvalReviewServer(options: EvalReviewServerOptions): Promise<http.Server> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4323;
  const server = createEvalReviewServer(options);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
}

export function createEvalReviewServer(options: EvalReviewServerOptions): http.Server {
  return http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, options);
    } catch (error) {
      sendError(res, error);
    }
  });
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: EvalReviewServerOptions
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderEvalReviewApp());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/candidates') {
    sendJson(res, await loadLabelingState(options));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/labels') {
    const input = LabelSubmissionSchema.parse(await readJson(req));
    const sample = await appendLabel(options, input);
    sendJson(res, { sample }, 201);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/decisions') {
    if (!options.db) {
      sendJson(res, { enabled: false, message: 'No database connection. Start with DATABASE_URL configured to browse live filter decisions.' });
      return;
    }
    const decision = url.searchParams.get('decision');
    const limit = clampLimit(Number(url.searchParams.get('limit') ?? 50));
    const [articles, samples, summary] = await Promise.all([
      listFilterDecisions(options.db, decision, limit),
      loadDatasetOrEmpty(options.datasetPath),
      summarizeFilterDecisions(options.db),
    ]);
    const labeledUrls = new Set(samples.map((sample) => sample.url));
    sendJson(res, {
      enabled: true,
      summary,
      articles: articles.map((article) => ({ ...article, alreadyLabeled: labeledUrls.has(article.url) })),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/labels/from-article') {
    if (!options.db) {
      sendJson(res, { error: { code: 'NO_DATABASE', message: 'No database connection.' } }, 400);
      return;
    }
    const input = ArticleLabelSubmissionSchema.parse(await readJson(req));
    const sample = await appendLabelFromArticle(options, options.db, input);
    sendJson(res, { sample }, 201);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/report') {
    const samples = await loadDatasetOrEmpty(options.datasetPath);
    const report = evaluateCheapFilterDataset(samples, {
      datasetPath: options.datasetPath,
      thresholds: DEFAULT_CHEAP_FILTER_THRESHOLDS,
    });
    sendJson(res, report);
    return;
  }

  sendJson(res, { error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
}

async function loadLabelingState(options: EvalReviewServerOptions): Promise<{
  candidates: unknown[];
  pendingCount: number;
  labeledCount: number;
}> {
  const [candidates, samples] = await Promise.all([
    loadCandidates(options.candidatesPath),
    loadDatasetOrEmpty(options.datasetPath),
  ]);
  const labeledUrls = new Set(samples.map((sample) => sample.url));
  const pending = candidates.filter((candidate) => !labeledUrls.has(candidate.url));
  return { candidates: pending, pendingCount: pending.length, labeledCount: samples.length };
}

async function appendLabel(
  options: EvalReviewServerOptions,
  input: z.infer<typeof LabelSubmissionSchema>
): Promise<unknown> {
  const [candidates, samples] = await Promise.all([
    loadCandidates(options.candidatesPath),
    loadDatasetOrEmpty(options.datasetPath),
  ]);
  const candidate = candidates.find((item) => item.id === input.candidateId);
  if (!candidate) {
    throw new NotFoundError(`Candidate ${input.candidateId} not found. Re-run npm run eval:candidates or refresh.`);
  }
  if (samples.some((sample) => sample.url === candidate.url)) {
    throw new ConflictError(`Candidate ${input.candidateId} is already labeled in the dataset.`);
  }

  const record = {
    id: candidate.id,
    sourceName: candidate.sourceName,
    sourceTier: candidate.sourceTier,
    url: candidate.url,
    title: candidate.title,
    rssSummary: candidate.rssSummary,
    rssCategories: candidate.rssCategories,
    publishedAt: candidate.publishedAt,
    humanLabel: input.humanLabel,
    humanReason: input.humanReason,
  };
  // Validate + derive before touching the dataset file.
  const sample = normalizeDatasetRecord(record);

  await mkdir(dirname(options.datasetPath), { recursive: true });
  await appendFile(options.datasetPath, `${JSON.stringify(record)}\n`);
  return sample;
}

async function loadDatasetOrEmpty(datasetPath: string): Promise<Awaited<ReturnType<typeof loadCheapFilterDataset>>> {
  try {
    return await loadCheapFilterDataset(datasetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_JSON_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof PayloadTooLargeError) {
    sendJson(res, { error: { code: 'PAYLOAD_TOO_LARGE', message: error.message } }, 413);
    return;
  }
  if (error instanceof NotFoundError) {
    sendJson(res, { error: { code: 'NOT_FOUND', message: error.message } }, 404);
    return;
  }
  if (error instanceof ConflictError) {
    sendJson(res, { error: { code: 'CONFLICT', message: error.message } }, 409);
    return;
  }
  if (error instanceof SyntaxError || error instanceof ZodError) {
    sendJson(
      res,
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Label input is invalid',
          details: error instanceof ZodError ? error.flatten() : undefined,
        },
      },
      422
    );
    return;
  }
  console.error(error);
  sendJson(res, { error: { code: 'SERVER_ERROR', message: (error as Error).message ?? 'Unexpected server error' } }, 500);
}

class PayloadTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_JSON_BODY_BYTES} bytes.`);
    this.name = 'PayloadTooLargeError';
  }
}

class NotFoundError extends Error {}
class ConflictError extends Error {}
