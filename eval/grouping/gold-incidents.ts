/**
 * Gold-incident baskets for grouping-pair eval (JSONL, committed alongside pair labels).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const GoldIncidentArticleSchema = z.object({
  articleId: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  sourceName: z.string().min(1),
});

export const GoldIncidentSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  articles: z.array(GoldIncidentArticleSchema).min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type GoldIncident = z.infer<typeof GoldIncidentSchema>;
export type GoldIncidentArticle = z.infer<typeof GoldIncidentArticleSchema>;

export class ArticleInMultipleGoldIncidentsError extends Error {
  readonly conflictingUrls: string[];
  readonly otherIncidentId: string;
  readonly otherIncidentName: string;

  constructor(opts: {
    conflictingUrls: string[];
    otherIncidentId: string;
    otherIncidentName: string;
  }) {
    const urls = opts.conflictingUrls.join(', ');
    super(
      `Article URL(s) already in gold incident "${opts.otherIncidentName}" (${opts.otherIncidentId}): ${urls}`
    );
    this.name = 'ArticleInMultipleGoldIncidentsError';
    this.conflictingUrls = opts.conflictingUrls;
    this.otherIncidentId = opts.otherIncidentId;
    this.otherIncidentName = opts.otherIncidentName;
  }
}

export async function loadGoldIncidents(path: string): Promise<GoldIncident[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const incidents: GoldIncident[] = [];
  const seen = new Map<string, number>();

  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const lineNumber = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid gold-incident JSON on line ${lineNumber}: ${(error as Error).message}`);
    }
    const result = GoldIncidentSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid gold-incident record on line ${lineNumber}: ${result.error.message}`);
    }
    const first = seen.get(result.data.id);
    if (first !== undefined) {
      throw new Error(`Duplicate gold incident id "${result.data.id}" on line ${lineNumber}`);
    }
    seen.set(result.data.id, lineNumber);
    incidents.push(result.data);
  });

  return incidents;
}

async function writeAll(path: string, incidents: GoldIncident[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = incidents.map((row) => JSON.stringify(row)).join('\n');
  await writeFile(path, body ? `${body}\n` : '', 'utf8');
}

export async function upsertGoldIncident(
  path: string,
  input: {
    id?: string;
    name: string;
    articles: GoldIncidentArticle[];
  }
): Promise<GoldIncident> {
  const incidents = await loadGoldIncidents(path);
  const now = new Date().toISOString();
  const id = input.id ?? randomUUID();
  const existingIndex = incidents.findIndex((row) => row.id === id);

  const inputUrls = new Set(input.articles.map((a) => a.url));
  for (const other of incidents) {
    if (other.id === id) continue;
    const conflictingUrls = other.articles.map((a) => a.url).filter((url) => inputUrls.has(url));
    if (conflictingUrls.length > 0) {
      throw new ArticleInMultipleGoldIncidentsError({
        conflictingUrls,
        otherIncidentId: other.id,
        otherIncidentName: other.name,
      });
    }
  }

  const next: GoldIncident = GoldIncidentSchema.parse({
    id,
    name: input.name,
    articles: input.articles,
    createdAt: existingIndex >= 0 ? incidents[existingIndex].createdAt : now,
    updatedAt: now,
  });

  if (existingIndex >= 0) incidents[existingIndex] = next;
  else incidents.push(next);

  await writeAll(path, incidents);
  return next;
}

export async function deleteGoldIncident(path: string, id: string): Promise<boolean> {
  const incidents = await loadGoldIncidents(path);
  const next = incidents.filter((row) => row.id !== id);
  if (next.length === incidents.length) return false;
  await writeAll(path, next);
  return true;
}
