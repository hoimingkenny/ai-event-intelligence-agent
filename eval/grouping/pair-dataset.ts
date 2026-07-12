/**
 * Grouping-pair eval dataset helpers: canonical pair keys, gold-incident expansion,
 * and JSONL load/append (URL-keyed, unordered-pair dedupe).
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

export const GROUPING_PAIR_LABELS = ['same_event', 'different_event', 'uncertain'] as const;
export type GroupingPairLabel = (typeof GROUPING_PAIR_LABELS)[number];

export const GroupingPairLabelRecordSchema = z.object({
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
  labeledAt: z.string().datetime().optional(),
});

export type GroupingPairLabelRecord = z.infer<typeof GroupingPairLabelRecordSchema>;

export function canonicalPairKey(urlA: string, urlB: string): string {
  return urlA < urlB ? `${urlA}\0${urlB}` : `${urlB}\0${urlA}`;
}

export function orderedPairUrls(urlA: string, urlB: string): { urlA: string; urlB: string } {
  return urlA < urlB ? { urlA, urlB } : { urlA: urlB, urlB: urlA };
}

/** Expand a gold-incident basket into all unordered article URL pairs. */
export function expandGoldIncidentPairs(urls: string[]): Array<{ urlA: string; urlB: string }> {
  const unique = [...new Set(urls.filter(Boolean))];
  const pairs: Array<{ urlA: string; urlB: string }> = [];
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      pairs.push(orderedPairUrls(unique[i], unique[j]));
    }
  }
  return pairs;
}

export function normalizePairRecord(record: GroupingPairLabelRecord): GroupingPairLabelRecord {
  const ordered = orderedPairUrls(record.urlA, record.urlB);
  const swap = ordered.urlA !== record.urlA;
  return {
    ...record,
    urlA: ordered.urlA,
    urlB: ordered.urlB,
    articleIdA: swap ? record.articleIdB : record.articleIdA,
    articleIdB: swap ? record.articleIdA : record.articleIdB,
    titleA: swap ? record.titleB : record.titleA,
    titleB: swap ? record.titleA : record.titleB,
    sourceNameA: swap ? record.sourceNameB : record.sourceNameA,
    sourceNameB: swap ? record.sourceNameA : record.sourceNameB,
    goldIncidentId: record.goldIncidentId ?? null,
    labeledAt: record.labeledAt ?? new Date().toISOString(),
  };
}

function parseDatasetLine(line: string, lineNumber: number): GroupingPairLabelRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Invalid grouping-pair dataset JSON on line ${lineNumber}: ${(error as Error).message}`);
  }

  const result = GroupingPairLabelRecordSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid grouping-pair dataset record on line ${lineNumber}: ${result.error.message}`);
  }

  return normalizePairRecord(result.data);
}

export async function loadGroupingPairDataset(path: string): Promise<GroupingPairLabelRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const samples: GroupingPairLabelRecord[] = [];
  const seen = new Map<string, number>();

  raw.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    const sample = parseDatasetLine(line, lineNumber);
    if (!sample) return;

    const key = canonicalPairKey(sample.urlA, sample.urlB);
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      throw new Error(
        `Duplicate grouping pair ${sample.urlA} | ${sample.urlB} on line ${lineNumber} (first seen on line ${firstLine}).`
      );
    }
    seen.set(key, lineNumber);
    samples.push(sample);
  });

  return samples;
}

export class DuplicateGroupingPairError extends Error {
  constructor(urlA: string, urlB: string) {
    super(`Duplicate grouping pair: ${urlA} | ${urlB}`);
    this.name = 'DuplicateGroupingPairError';
  }
}

export async function appendGroupingPairLabel(
  path: string,
  record: GroupingPairLabelRecord
): Promise<GroupingPairLabelRecord> {
  const normalized = normalizePairRecord(GroupingPairLabelRecordSchema.parse(record));
  const existing = await loadGroupingPairDataset(path);
  const key = canonicalPairKey(normalized.urlA, normalized.urlB);
  if (existing.some((row) => canonicalPairKey(row.urlA, row.urlB) === key)) {
    throw new DuplicateGroupingPairError(normalized.urlA, normalized.urlB);
  }

  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(normalized)}\n`, 'utf8');
  return normalized;
}

/** Insert or replace a pair label (unordered URL key). Rewrites the JSONL file. */
export async function upsertGroupingPairLabel(
  path: string,
  record: GroupingPairLabelRecord
): Promise<{ pair: GroupingPairLabelRecord; created: boolean }> {
  const normalized = normalizePairRecord(GroupingPairLabelRecordSchema.parse(record));
  const existing = await loadGroupingPairDataset(path);
  const key = canonicalPairKey(normalized.urlA, normalized.urlB);
  const index = existing.findIndex((row) => canonicalPairKey(row.urlA, row.urlB) === key);
  let created = true;
  if (index >= 0) {
    existing[index] = normalized;
    created = false;
  } else {
    existing.push(normalized);
  }
  await mkdir(dirname(path), { recursive: true });
  const body = existing.map((row) => JSON.stringify(row)).join('\n');
  await writeFile(path, body ? `${body}\n` : '', 'utf8');
  return { pair: normalized, created };
}
