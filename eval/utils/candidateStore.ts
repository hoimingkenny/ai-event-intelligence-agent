import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  CHEAP_FILTER_DECISIONS,
  SOURCE_TIERS,
  type CheapFilterCandidate,
} from '../types/cheap-filter-eval.types.js';

export const CheapFilterCandidateSchema = z.object({
  id: z.string().min(1),
  sourceName: z.string().min(1),
  sourceTier: z.enum(SOURCE_TIERS),
  url: z.string().url(),
  title: z.string().min(1),
  rssSummary: z.string().nullable(),
  rssCategories: z.array(z.string()),
  publishedAt: z.string().nullable(),
  harvest: z.object({
    decision: z.enum(CHEAP_FILTER_DECISIONS),
    score: z.number().nullable(),
    harvestedAt: z.string(),
  }),
});

export async function loadCandidates(path: string): Promise<CheapFilterCandidate[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const candidates: CheapFilterCandidate[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Invalid candidate JSON on line ${index + 1}: ${(error as Error).message}`);
    }
    const result = CheapFilterCandidateSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid candidate record on line ${index + 1}: ${result.error.message}`);
    }
    candidates.push(result.data);
  });
  return candidates;
}

export async function writeCandidates(path: string, candidates: CheapFilterCandidate[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = candidates.map((candidate) => JSON.stringify(candidate)).join('\n');
  await writeFile(path, body.length > 0 ? `${body}\n` : '');
}
