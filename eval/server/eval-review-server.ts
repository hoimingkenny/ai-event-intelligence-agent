import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { URL } from 'node:url';
import { z, ZodError } from 'zod';
import { loadCheapFilterDataset, normalizeDatasetRecord } from '../utils/datasetLoader.js';
import { loadCandidates } from '../utils/candidateStore.js';
import { evaluateCheapFilterDataset, DEFAULT_CHEAP_FILTER_THRESHOLDS } from '../utils/metrics.js';
import { HUMAN_LABELS } from '../types/cheap-filter-eval.types.js';
import { renderEvalReviewApp } from './eval-review-page.js';

const MAX_JSON_BODY_BYTES = 64 * 1024;

export interface EvalReviewServerOptions {
  datasetPath: string;
  candidatesPath: string;
  host?: string;
  port?: number;
}

const LabelSubmissionSchema = z.object({
  candidateId: z.string().min(1),
  humanLabel: z.enum(HUMAN_LABELS),
  humanReason: z.string().trim().min(3, 'humanReason must explain the judgement (min 3 characters).'),
});

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
