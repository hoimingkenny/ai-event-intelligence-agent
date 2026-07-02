import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractReadableContent } from '../src/extraction/readable-content.js';

/**
 * Regression test over real-HTML fixtures saved via `npm run fixtures:fetch -- <url>`.
 * Skipped automatically when no fixtures exist.
 * If a human reference exists (<fixture>.expected.txt), asserts word-level
 * recall >= 0.8 (we captured the article) and precision >= 0.6 (limited noise).
 */
const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'real');
const MANIFEST_PATH = join(FIXTURES_DIR, 'manifest.json');

const manifest: Record<string, { url: string }> = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  : {};
const names = Object.keys(manifest);

describe.skipIf(names.length === 0)('real HTML fixture extraction', () => {
  it.each(names)('%s extracts non-empty article text', (name) => {
    const html = readFileSync(join(FIXTURES_DIR, name), 'utf8');
    const result = extractReadableContent(html, manifest[name].url);

    expect(result.cleanText, `extraction returned empty for ${manifest[name].url}`).toBeTruthy();
    expect(result.cleanText!.length).toBeGreaterThan(200);
  });

  const withExpected = names.filter((name) => existsSync(join(FIXTURES_DIR, `${name}.expected.txt`)));

  it.skipIf(withExpected.length === 0).each(withExpected)(
    '%s matches human reference (recall>=0.8, precision>=0.6)',
    (name) => {
      const html = readFileSync(join(FIXTURES_DIR, name), 'utf8');
      const expected = readFileSync(join(FIXTURES_DIR, `${name}.expected.txt`), 'utf8');
      const extracted = extractReadableContent(html, manifest[name].url).cleanText ?? '';
      const { recall, precision } = wordOverlap(expected, extracted);

      expect(recall, 'missed too much of the human-identified article text').toBeGreaterThanOrEqual(0.8);
      expect(precision, 'too much noise beyond the human-identified article text').toBeGreaterThanOrEqual(0.6);
    }
  );
});

function wordOverlap(expected: string, extracted: string): { recall: number; precision: number } {
  const expectedWords = toWordCounts(expected);
  const extractedWords = toWordCounts(extracted);
  return {
    recall: overlapRatio(expectedWords, extractedWords),
    precision: overlapRatio(extractedWords, expectedWords),
  };
}

function toWordCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.-]*/gu) ?? []) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

function overlapRatio(from: Map<string, number>, against: Map<string, number>): number {
  let total = 0;
  let matched = 0;
  for (const [word, count] of from) {
    total += count;
    matched += Math.min(count, against.get(word) ?? 0);
  }
  return total === 0 ? 0 : matched / total;
}
