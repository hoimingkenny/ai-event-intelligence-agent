/**
 * Run Readability extraction over saved real-HTML fixtures and build a
 * side-by-side review page: original rendered page (left) vs extracted
 * cleanText (right), so a human can judge extraction quality.
 *
 * Usage:
 *   npx tsx scripts/review-extraction.ts
 *
 * Optional human reference: put the text YOU consider the true article body in
 *   tests/fixtures/real/<fixture-name>.expected.txt
 * and the report will show word-level recall (coverage of your text) and
 * precision (how much extracted text is not in yours, i.e. noise).
 *
 * Output: review/extraction/index.html + review/extraction/<name>.extracted.txt
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractReadableContent } from '../src/extraction/readable-content.js';
import { contentQualityScore } from '../src/extraction/content-cleaner.js';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'real');
const MANIFEST_PATH = join(FIXTURES_DIR, 'manifest.json');
const OUTPUT_DIR = join(process.cwd(), 'review', 'extraction');

interface ManifestEntry {
  url: string;
  fetchedAt: string;
  httpStatus: number;
}

interface ReviewRow {
  name: string;
  url: string;
  method: string;
  score: number;
  extractedChars: number;
  recall: number | null;
  precision: number | null;
  rawHtml: string;
  extracted: string;
  expected: string | null;
}

async function main(): Promise<void> {
  const manifest: Record<string, ManifestEntry> = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const names = Object.keys(manifest);
  if (names.length === 0) {
    console.error('No fixtures. Run: npx tsx scripts/fetch-fixture.ts <url>');
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const rows: ReviewRow[] = [];

  for (const name of names) {
    const rawHtml = await readFile(join(FIXTURES_DIR, name), 'utf8');
    const { url } = manifest[name];
    const result = extractReadableContent(rawHtml, url);
    const extracted = result.cleanText ?? '';
    const expected = await readOptional(join(FIXTURES_DIR, `${name}.expected.txt`));
    const { recall, precision } = expected
      ? wordOverlap(expected, extracted)
      : { recall: null, precision: null };

    await writeFile(join(OUTPUT_DIR, `${name}.extracted.txt`), extracted, 'utf8');
    rows.push({
      name,
      url,
      method: result.method,
      score: contentQualityScore(extracted),
      extractedChars: extracted.length,
      recall,
      precision,
      rawHtml,
      extracted,
      expected,
    });

    console.log(
      `${name}: method=${result.method} chars=${extracted.length} score=${contentQualityScore(extracted).toFixed(2)}` +
        (recall !== null ? ` recall=${(recall * 100).toFixed(0)}% precision=${(precision! * 100).toFixed(0)}%` : '')
    );
  }

  await writeFile(join(OUTPUT_DIR, 'index.html'), buildReport(rows), 'utf8');
  console.log(`\nreview page: ${join(OUTPUT_DIR, 'index.html')}`);
}

/**
 * Word-level overlap between the human reference and extracted text.
 * recall    = fraction of reference words present in extracted (did we get the article?)
 * precision = fraction of extracted words present in reference (how much noise?)
 */
export function wordOverlap(expected: string, extracted: string): { recall: number; precision: number } {
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

function buildReport(rows: ReviewRow[]): string {
  const sections = rows
    .map((row, index) => {
      const metrics =
        row.recall !== null
          ? `<span class="metric">recall ${(row.recall * 100).toFixed(0)}%</span>
             <span class="metric">precision ${((row.precision ?? 0) * 100).toFixed(0)}%</span>`
          : '<span class="metric muted">no .expected.txt reference</span>';
      return `
  <details ${index === 0 ? 'open' : ''}>
    <summary>
      <strong>${escapeHtml(row.name)}</strong>
      <span class="metric">${row.method}</span>
      <span class="metric">${row.extractedChars} chars</span>
      <span class="metric">score ${row.score.toFixed(2)}</span>
      ${metrics}
      — <a href="${escapeHtml(row.url)}" target="_blank">original</a>
    </summary>
    <div class="pair">
      <div class="pane">
        <h3>Original page (rendered, scripts off)</h3>
        <iframe sandbox="" srcdoc="${escapeHtml(row.rawHtml)}"></iframe>
      </div>
      <div class="pane">
        <h3>Extracted cleanText</h3>
        <pre>${escapeHtml(row.extracted) || '<em>(empty)</em>'}</pre>
        ${row.expected ? `<h3>Your reference (.expected.txt)</h3><pre class="expected">${escapeHtml(row.expected)}</pre>` : ''}
      </div>
    </div>
  </details>`;
    })
    .join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Extraction review</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 16px; }
  summary { cursor: pointer; padding: 8px; background: #f2f2f2; border-radius: 6px; margin-top: 8px; }
  .metric { background: #e0e7ff; border-radius: 4px; padding: 1px 6px; font-size: 12px; margin-left: 6px; }
  .metric.muted { background: #eee; color: #777; }
  .pair { display: flex; gap: 12px; height: 80vh; margin-top: 8px; }
  .pane { flex: 1; overflow: auto; border: 1px solid #ddd; border-radius: 6px; padding: 8px; }
  iframe { width: 100%; height: 95%; border: 0; }
  pre { white-space: pre-wrap; font-size: 13px; line-height: 1.5; }
  pre.expected { background: #f6fff6; }
</style></head><body>
<h1>Readability extraction review</h1>
<p>Left: the raw HTML as fetched (rendered without scripts). Right: what the pipeline extracted.
Add <code>tests/fixtures/real/&lt;name&gt;.expected.txt</code> with the text you consider correct to get recall/precision.</p>
${sections}
</body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

const isDirectRun = process.argv[1]?.endsWith('review-extraction.ts');
if (isDirectRun) main();
