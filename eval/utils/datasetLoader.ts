import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  CHEAP_FILTER_DECISIONS,
  HUMAN_LABELS,
  SOURCE_TIERS,
  type CheapFilterEvaluationSample,
} from '../types/cheap-filter-eval.types.js';
import {
  checkLabelDecisionConsistency,
  deriveExpectedMinimumDecision,
  deriveExpectedSignals,
  deriveSampleId,
} from './derive.js';

const ExpectedSignalsSchema = z.object({
  monitoredVendorPresent: z.boolean(),
  monitoredProductPresent: z.boolean(),
  cvePresent: z.boolean(),
  criticalSignalPresent: z.boolean(),
  mediumSignalPresent: z.boolean(),
});

/**
 * Raw dataset record as humans author it. Only source metadata + the human
 * judgement are required; id, expectedMinimumDecision, and expectedSignals are
 * derived when omitted.
 */
export const CheapFilterDatasetRecordSchema = z.object({
  id: z.string().min(1).optional(),
  sourceName: z.string().min(1),
  sourceTier: z.enum(SOURCE_TIERS),
  url: z.string().url(),
  title: z.string().min(1),
  rssSummary: z.string().nullable(),
  rssCategories: z.array(z.string()),
  publishedAt: z.string().datetime().nullable(),
  humanLabel: z.enum(HUMAN_LABELS),
  humanReason: z.string().min(1),
  expectedMinimumDecision: z.enum(CHEAP_FILTER_DECISIONS).optional(),
  expectedSignals: ExpectedSignalsSchema.optional(),
});

export type CheapFilterDatasetRecord = z.infer<typeof CheapFilterDatasetRecordSchema>;

/** Normalizes a validated raw record into a fully populated evaluation sample. */
export function normalizeDatasetRecord(record: CheapFilterDatasetRecord): CheapFilterEvaluationSample {
  if (record.expectedMinimumDecision) {
    const inconsistency = checkLabelDecisionConsistency(record.humanLabel, record.expectedMinimumDecision);
    if (inconsistency) throw new Error(inconsistency);
  }

  return {
    ...record,
    id: record.id ?? deriveSampleId(record.url),
    expectedMinimumDecision: record.expectedMinimumDecision ?? deriveExpectedMinimumDecision(record.humanLabel),
    expectedSignals:
      record.expectedSignals ??
      deriveExpectedSignals({
        title: record.title,
        rssSummary: record.rssSummary,
        rssCategories: record.rssCategories,
        humanReason: record.humanReason,
      }),
  };
}

export function parseDatasetLine(line: string, lineNumber: number): CheapFilterEvaluationSample | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Invalid cheap-filter dataset JSON on line ${lineNumber}: ${(error as Error).message}`);
  }

  const result = CheapFilterDatasetRecordSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid cheap-filter dataset record on line ${lineNumber}: ${result.error.message}`);
  }

  try {
    return normalizeDatasetRecord(result.data);
  } catch (error) {
    throw new Error(`Inconsistent cheap-filter dataset record on line ${lineNumber}: ${(error as Error).message}`);
  }
}

export async function loadCheapFilterDataset(path: string): Promise<CheapFilterEvaluationSample[]> {
  const raw = await readFile(path, 'utf8');
  const lines = raw.split(/\r?\n/);
  const samples: CheapFilterEvaluationSample[] = [];
  const seenIds = new Map<string, number>();
  const seenUrls = new Map<string, number>();

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const sample = parseDatasetLine(line, lineNumber);
    if (!sample) return;

    const duplicateIdLine = seenIds.get(sample.id);
    if (duplicateIdLine !== undefined) {
      throw new Error(`Duplicate sample id "${sample.id}" on line ${lineNumber} (first seen on line ${duplicateIdLine}).`);
    }
    const duplicateUrlLine = seenUrls.get(sample.url);
    if (duplicateUrlLine !== undefined) {
      throw new Error(`Duplicate sample url "${sample.url}" on line ${lineNumber} (first seen on line ${duplicateUrlLine}).`);
    }
    seenIds.set(sample.id, lineNumber);
    seenUrls.set(sample.url, lineNumber);
    samples.push(sample);
  });

  return samples;
}
