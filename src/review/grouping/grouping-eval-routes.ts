/**
 * HTTP routes for grouping-pair eval (gold incidents, uncertain overrides, threshold report).
 * Same/different labels are derived from gold baskets at report time.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { URL } from 'node:url';
import { z, ZodError } from 'zod';
import type { Queryable } from '../../db/repositories/types.js';
import {
  DuplicateGroupingPairError,
  NonUncertainOverrideError,
  appendGroupingPairLabel,
  deleteGroupingPairOverride,
  deriveGroupingPairsFromGoldIncidents,
  loadGroupingPairDataset,
  upsertGroupingPairLabel,
} from '../../../eval/grouping/pair-dataset.js';
import {
  ArticleInMultipleGoldIncidentsError,
  deleteGoldIncident,
  loadGoldIncidents,
  upsertGoldIncident,
} from '../../../eval/grouping/gold-incidents.js';
import { evaluateGroupingPairDataset } from '../../../eval/grouping/pair-metrics.js';
import { scoreGroupingPairs, searchArticlesForPicker } from '../../../eval/grouping/score-pairs.js';
import {
  EMBEDDING_ATTACH_DISTANCE,
  EMBEDDING_UNCERTAIN_DISTANCE,
} from '../../events/grouping-decision.js';

const MAX_JSON_BODY_BYTES = 512 * 1024;

export interface GroupingEvalServerOptions {
  pairDatasetPath: string;
  goldIncidentsPath: string;
  db: Queryable | null;
}

const UncertainOverrideSchema = z.object({
  urlA: z.string().url(),
  urlB: z.string().url(),
  label: z.literal('uncertain'),
  humanReason: z.string().trim().min(3),
  goldIncidentId: z.string().min(1).nullable().optional(),
  articleIdA: z.string().min(1).nullable().optional(),
  articleIdB: z.string().min(1).nullable().optional(),
  titleA: z.string().optional(),
  titleB: z.string().optional(),
  sourceNameA: z.string().optional(),
  sourceNameB: z.string().optional(),
});

const GoldIncidentUpsertSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1),
  articles: z
    .array(
      z.object({
        articleId: z.string().min(1),
        url: z.string().url(),
        title: z.string().min(1),
        sourceName: z.string().min(1),
      })
    )
    .min(1),
});

const ReportQuerySchema = z.object({
  attach: z.coerce.number().min(0).max(2).default(EMBEDDING_ATTACH_DISTANCE),
  uncertain: z.coerce.number().min(0).max(2).default(EMBEDDING_UNCERTAIN_DISTANCE),
});

export function defaultGroupingEvalPaths(): Pick<GroupingEvalServerOptions, 'pairDatasetPath' | 'goldIncidentsPath'> {
  return {
    pairDatasetPath: join(process.cwd(), 'eval/datasets/grouping-pair-eval.jsonl'),
    goldIncidentsPath: join(process.cwd(), 'eval/datasets/grouping-gold-incidents.jsonl'),
  };
}

export async function routeGroupingEvalRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: GroupingEvalServerOptions
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (!path.startsWith('/api/grouping-eval/')) return false;

  try {
    if (req.method === 'GET' && path === '/api/grouping-eval/articles') {
      requireDb(options);
      const q = url.searchParams.get('q') ?? '';
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 30)));
      const articles = await searchArticlesForPicker(options.db!, q, limit);
      sendJson(res, { articles });
      return true;
    }

    if (req.method === 'GET' && path === '/api/grouping-eval/incidents') {
      const incidents = await loadGoldIncidents(options.goldIncidentsPath);
      sendJson(res, { incidents });
      return true;
    }

    if (req.method === 'POST' && path === '/api/grouping-eval/incidents') {
      const body = GoldIncidentUpsertSchema.parse(await readJson(req));
      const incident = await upsertGoldIncident(options.goldIncidentsPath, body);
      sendJson(res, { incident }, 201);
      return true;
    }

    if (req.method === 'DELETE' && path.startsWith('/api/grouping-eval/incidents/')) {
      const id = decodeURIComponent(path.slice('/api/grouping-eval/incidents/'.length));
      const ok = await deleteGoldIncident(options.goldIncidentsPath, id);
      if (!ok) {
        sendJson(res, { error: { code: 'NOT_FOUND', message: 'Gold incident not found' } }, 404);
        return true;
      }
      sendJson(res, { deleted: true });
      return true;
    }

    if (req.method === 'GET' && path === '/api/grouping-eval/pairs') {
      const overrides = (await loadGroupingPairDataset(options.pairDatasetPath)).filter(
        (row) => row.label === 'uncertain'
      );
      sendJson(res, { pairs: overrides, count: overrides.length });
      return true;
    }

    if (req.method === 'POST' && path === '/api/grouping-eval/pairs') {
      const body = UncertainOverrideSchema.parse(await readJson(req));
      const upsert = url.searchParams.get('upsert') === '1' || url.searchParams.get('upsert') === 'true';
      if (upsert) {
        const result = await upsertGroupingPairLabel(options.pairDatasetPath, body);
        sendJson(res, { pair: result.pair, created: result.created }, result.created ? 201 : 200);
        return true;
      }
      const saved = await appendGroupingPairLabel(options.pairDatasetPath, body);
      sendJson(res, { pair: saved, created: true }, 201);
      return true;
    }

    if (req.method === 'DELETE' && path === '/api/grouping-eval/pairs') {
      const body = z
        .object({ urlA: z.string().url(), urlB: z.string().url() })
        .parse(await readJson(req));
      const deleted = await deleteGroupingPairOverride(options.pairDatasetPath, body.urlA, body.urlB);
      if (!deleted) {
        sendJson(res, { error: { code: 'NOT_FOUND', message: 'Override not found' } }, 404);
        return true;
      }
      sendJson(res, { deleted: true });
      return true;
    }

    if (req.method === 'GET' && path === '/api/grouping-eval/report') {
      requireDb(options);
      const thresholds = ReportQuerySchema.parse({
        attach: url.searchParams.get('attach') ?? EMBEDDING_ATTACH_DISTANCE,
        uncertain: url.searchParams.get('uncertain') ?? EMBEDDING_UNCERTAIN_DISTANCE,
      });
      if (thresholds.attach > thresholds.uncertain) {
        sendJson(
          res,
          { error: { code: 'INVALID_THRESHOLDS', message: 'attach must be <= uncertain' } },
          400
        );
        return true;
      }
      const incidents = await loadGoldIncidents(options.goldIncidentsPath);
      const overrides = await loadGroupingPairDataset(options.pairDatasetPath);
      const pairs = deriveGroupingPairsFromGoldIncidents(incidents, overrides);
      const scored = await scoreGroupingPairs(options.db!, pairs);
      const report = evaluateGroupingPairDataset(scored, thresholds);
      const needsSecondGoldIncident = incidents.length < 2;
      sendJson(res, {
        report,
        pairs: scored,
        meta: {
          goldIncidentCount: incidents.length,
          needsSecondGoldIncident,
          differentEmptyHint: needsSecondGoldIncident
            ? 'Need ≥2 gold incidents to derive different_event pairs.'
            : null,
        },
      });
      return true;
    }

    sendJson(res, { error: { code: 'NOT_FOUND', message: 'Grouping eval route not found' } }, 404);
    return true;
  } catch (error) {
    sendGroupingEvalError(res, error);
    return true;
  }
}

function requireDb(options: GroupingEvalServerOptions): void {
  if (!options.db) {
    throw new NoDatabaseError();
  }
}

class NoDatabaseError extends Error {
  constructor() {
    super('Database connection required for this grouping-eval route.');
    this.name = 'NoDatabaseError';
  }
}

class PayloadTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_JSON_BODY_BYTES} bytes.`);
    this.name = 'PayloadTooLargeError';
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_JSON_BODY_BYTES) throw new PayloadTooLargeError();
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

export function sendGroupingEvalError(res: ServerResponse, error: unknown): void {
  if (error instanceof PayloadTooLargeError) {
    sendJson(res, { error: { code: 'PAYLOAD_TOO_LARGE', message: error.message } }, 413);
    return;
  }
  if (error instanceof NoDatabaseError) {
    sendJson(res, { error: { code: 'NO_DATABASE', message: error.message } }, 400);
    return;
  }
  if (error instanceof DuplicateGroupingPairError) {
    sendJson(res, { error: { code: 'DUPLICATE_PAIR', message: error.message } }, 409);
    return;
  }
  if (error instanceof NonUncertainOverrideError) {
    sendJson(res, { error: { code: 'INVALID_OVERRIDE', message: error.message } }, 400);
    return;
  }
  if (error instanceof ArticleInMultipleGoldIncidentsError) {
    sendJson(res, { error: { code: 'ARTICLE_OVERLAP', message: error.message } }, 409);
    return;
  }
  if (error instanceof ZodError) {
    sendJson(res, { error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? error.message } }, 400);
    return;
  }
  sendJson(
    res,
    { error: { code: 'INTERNAL', message: error instanceof Error ? error.message : 'Unknown error' } },
    500
  );
}
