/**
 * HTTP routes for grouping-pair eval (gold incidents, pair labels, threshold report).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { URL } from 'node:url';
import { z, ZodError } from 'zod';
import type { Queryable } from '../../db/repositories/types.js';
import {
  DuplicateGroupingPairError,
  GROUPING_PAIR_LABELS,
  appendGroupingPairLabel,
  canonicalPairKey,
  expandGoldIncidentPairs,
  loadGroupingPairDataset,
  upsertGroupingPairLabel,
  type GroupingPairLabelRecord,
} from '../../../eval/grouping/pair-dataset.js';
import {
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

const PairLabelSchema = z.object({
  urlA: z.string().url(),
  urlB: z.string().url(),
  label: z.enum(GROUPING_PAIR_LABELS),
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

const BulkSameSchema = z.object({
  goldIncidentId: z.string().min(1),
  humanReason: z.string().trim().min(3),
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
      const pairs = await loadGroupingPairDataset(options.pairDatasetPath);
      sendJson(res, { pairs, count: pairs.length });
      return true;
    }

    if (req.method === 'POST' && path === '/api/grouping-eval/pairs') {
      const body = PairLabelSchema.parse(await readJson(req));
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

    if (req.method === 'POST' && path === '/api/grouping-eval/incidents/bulk-same') {
      const body = BulkSameSchema.parse(await readJson(req));
      const incidents = await loadGoldIncidents(options.goldIncidentsPath);
      const incident = incidents.find((row) => row.id === body.goldIncidentId);
      if (!incident) {
        sendJson(res, { error: { code: 'NOT_FOUND', message: 'Gold incident not found' } }, 404);
        return true;
      }

      const existing = await loadGroupingPairDataset(options.pairDatasetPath);
      const existingKeys = new Set(existing.map((p) => canonicalPairKey(p.urlA, p.urlB)));
      const expanded = expandGoldIncidentPairs(incident.articles.map((a) => a.url));
      const saved: GroupingPairLabelRecord[] = [];
      const skipped: string[] = [];

      for (const pair of expanded) {
        const key = canonicalPairKey(pair.urlA, pair.urlB);
        if (existingKeys.has(key)) {
          skipped.push(`${pair.urlA} | ${pair.urlB}`);
          continue;
        }
        const articleA = incident.articles.find((a) => a.url === pair.urlA);
        const articleB = incident.articles.find((a) => a.url === pair.urlB);
        const record = await appendGroupingPairLabel(options.pairDatasetPath, {
          urlA: pair.urlA,
          urlB: pair.urlB,
          label: 'same_event',
          humanReason: body.humanReason,
          goldIncidentId: incident.id,
          articleIdA: articleA?.articleId ?? null,
          articleIdB: articleB?.articleId ?? null,
          titleA: articleA?.title,
          titleB: articleB?.title,
          sourceNameA: articleA?.sourceName,
          sourceNameB: articleB?.sourceName,
        });
        existingKeys.add(key);
        saved.push(record);
      }

      sendJson(res, { savedCount: saved.length, skippedCount: skipped.length, saved, skipped }, 201);
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
      const pairs = await loadGroupingPairDataset(options.pairDatasetPath);
      const scored = await scoreGroupingPairs(options.db!, pairs);
      const report = evaluateGroupingPairDataset(scored, thresholds);
      sendJson(res, { report, pairs: scored });
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
