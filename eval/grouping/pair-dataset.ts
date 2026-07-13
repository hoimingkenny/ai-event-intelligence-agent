/**
 * Grouping-pair eval dataset helpers: canonical pair keys, gold-incident expansion,
 * derive same/different from gold baskets, and JSONL overrides (uncertain only).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { GoldIncident } from './gold-incidents.js';

export const GROUPING_PAIR_LABELS = ['same_event', 'different_event', 'uncertain'] as const;
export type GroupingPairLabel = (typeof GROUPING_PAIR_LABELS)[number];

/** Persisted overrides are uncertain-only; same/different are derived from gold incidents. */
export const GROUPING_OVERRIDE_LABELS = ['uncertain'] as const;
export type GroupingOverrideLabel = (typeof GROUPING_OVERRIDE_LABELS)[number];

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

type OverrideInput = Pick<GroupingPairLabelRecord, 'urlA' | 'urlB' | 'label' | 'humanReason'> &
  Partial<
    Pick<
      GroupingPairLabelRecord,
      'goldIncidentId' | 'articleIdA' | 'articleIdB' | 'titleA' | 'titleB' | 'sourceNameA' | 'sourceNameB' | 'labeledAt'
    >
  >;

/**
 * Derive eval pairs from gold incidents:
 * - within basket → same_event
 * - across baskets → different_event
 * - uncertain overrides (by unordered URL key) win over derived labels
 * Non-uncertain override rows are ignored (legacy materialized labels).
 */
export function deriveGroupingPairsFromGoldIncidents(
  incidents: GoldIncident[],
  overrides: OverrideInput[] = []
): GroupingPairLabelRecord[] {
  const overrideByKey = new Map<string, OverrideInput>();
  for (const row of overrides) {
    if (row.label !== 'uncertain') continue;
    overrideByKey.set(canonicalPairKey(row.urlA, row.urlB), row);
  }

  const articleByUrl = new Map<
    string,
    { incidentId: string; articleId: string; title: string; sourceName: string }
  >();
  for (const incident of incidents) {
    for (const article of incident.articles) {
      if (!articleByUrl.has(article.url)) {
        articleByUrl.set(article.url, {
          incidentId: incident.id,
          articleId: article.articleId,
          title: article.title,
          sourceName: article.sourceName,
        });
      }
    }
  }

  const derived = new Map<string, GroupingPairLabelRecord>();

  for (const incident of incidents) {
    for (const pair of expandGoldIncidentPairs(incident.articles.map((a) => a.url))) {
      const key = canonicalPairKey(pair.urlA, pair.urlB);
      const left = articleByUrl.get(pair.urlA);
      const right = articleByUrl.get(pair.urlB);
      derived.set(key, {
        urlA: pair.urlA,
        urlB: pair.urlB,
        label: 'same_event',
        humanReason: `Derived from gold incident "${incident.name}".`,
        goldIncidentId: incident.id,
        articleIdA: left?.articleId ?? null,
        articleIdB: right?.articleId ?? null,
        titleA: left?.title,
        titleB: right?.title,
        sourceNameA: left?.sourceName,
        sourceNameB: right?.sourceName,
      });
    }
  }

  for (let i = 0; i < incidents.length; i += 1) {
    for (let j = i + 1; j < incidents.length; j += 1) {
      const leftIncident = incidents[i];
      const rightIncident = incidents[j];
      for (const leftArticle of leftIncident.articles) {
        for (const rightArticle of rightIncident.articles) {
          const ordered = orderedPairUrls(leftArticle.url, rightArticle.url);
          const key = canonicalPairKey(ordered.urlA, ordered.urlB);
          if (derived.has(key)) continue;
          const left = articleByUrl.get(ordered.urlA);
          const right = articleByUrl.get(ordered.urlB);
          derived.set(key, {
            urlA: ordered.urlA,
            urlB: ordered.urlB,
            label: 'different_event',
            humanReason: `Derived across gold incidents "${leftIncident.name}" and "${rightIncident.name}".`,
            goldIncidentId: null,
            articleIdA: left?.articleId ?? null,
            articleIdB: right?.articleId ?? null,
            titleA: left?.title,
            titleB: right?.title,
            sourceNameA: left?.sourceName,
            sourceNameB: right?.sourceName,
          });
        }
      }
    }
  }

  const pairs: GroupingPairLabelRecord[] = [];
  for (const [key, pair] of derived) {
    const override = overrideByKey.get(key);
    if (override) {
      pairs.push(
        normalizePairRecord({
          ...pair,
          label: 'uncertain',
          humanReason: override.humanReason,
          labeledAt: override.labeledAt,
        })
      );
      overrideByKey.delete(key);
      continue;
    }
    pairs.push(normalizePairRecord(pair));
  }

  // Orphan uncertain overrides (pair no longer in any gold basket) stay visible for the tuner.
  for (const override of overrideByKey.values()) {
    pairs.push(
      normalizePairRecord({
        urlA: override.urlA,
        urlB: override.urlB,
        label: 'uncertain',
        humanReason: override.humanReason,
        goldIncidentId: override.goldIncidentId ?? null,
        articleIdA: override.articleIdA ?? null,
        articleIdB: override.articleIdB ?? null,
        titleA: override.titleA,
        titleB: override.titleB,
        sourceNameA: override.sourceNameA,
        sourceNameB: override.sourceNameB,
        labeledAt: override.labeledAt,
      })
    );
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

export class NonUncertainOverrideError extends Error {
  constructor(label: string) {
    super(`Grouping pair overrides must be label "uncertain" (got "${label}"). Same/different are derived from gold incidents.`);
    this.name = 'NonUncertainOverrideError';
  }
}

function requireUncertainOverride(record: GroupingPairLabelRecord): void {
  if (record.label !== 'uncertain') {
    throw new NonUncertainOverrideError(record.label);
  }
}

/** Keep only uncertain rows in the overrides JSONL (migration / cleanup). */
export async function rewriteUncertainOverridesOnly(path: string): Promise<{ kept: number; dropped: number }> {
  const existing = await loadGroupingPairDataset(path);
  const keptRows = existing.filter((row) => row.label === 'uncertain');
  await mkdir(dirname(path), { recursive: true });
  const body = keptRows.map((row) => JSON.stringify(row)).join('\n');
  await writeFile(path, body ? `${body}\n` : '', 'utf8');
  return { kept: keptRows.length, dropped: existing.length - keptRows.length };
}

export async function appendGroupingPairLabel(
  path: string,
  record: GroupingPairLabelRecord
): Promise<GroupingPairLabelRecord> {
  const normalized = normalizePairRecord(GroupingPairLabelRecordSchema.parse(record));
  requireUncertainOverride(normalized);
  const existing = (await loadGroupingPairDataset(path)).filter((row) => row.label === 'uncertain');
  const key = canonicalPairKey(normalized.urlA, normalized.urlB);
  if (existing.some((row) => canonicalPairKey(row.urlA, row.urlB) === key)) {
    throw new DuplicateGroupingPairError(normalized.urlA, normalized.urlB);
  }

  existing.push(normalized);
  await mkdir(dirname(path), { recursive: true });
  const body = existing.map((row) => JSON.stringify(row)).join('\n');
  await writeFile(path, body ? `${body}\n` : '', 'utf8');
  return normalized;
}

/** Insert or replace an uncertain override (unordered URL key). Rewrites the JSONL file. */
export async function upsertGroupingPairLabel(
  path: string,
  record: GroupingPairLabelRecord
): Promise<{ pair: GroupingPairLabelRecord; created: boolean }> {
  const normalized = normalizePairRecord(GroupingPairLabelRecordSchema.parse(record));
  requireUncertainOverride(normalized);
  const existing = (await loadGroupingPairDataset(path)).filter((row) => row.label === 'uncertain');
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

/** Remove an uncertain override by unordered URL pair. */
export async function deleteGroupingPairOverride(
  path: string,
  urlA: string,
  urlB: string
): Promise<boolean> {
  const existing = (await loadGroupingPairDataset(path)).filter((row) => row.label === 'uncertain');
  const key = canonicalPairKey(urlA, urlB);
  const next = existing.filter((row) => canonicalPairKey(row.urlA, row.urlB) !== key);
  if (next.length === existing.length) return false;
  await mkdir(dirname(path), { recursive: true });
  const body = next.map((row) => JSON.stringify(row)).join('\n');
  await writeFile(path, body ? `${body}\n` : '', 'utf8');
  return true;
}
