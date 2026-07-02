/**
 * Fetch real article pages and save raw HTML as extraction test fixtures.
 *
 * Usage:
 *   npx tsx scripts/fetch-fixture.ts <url> [<url> ...]
 *
 * Saves to tests/fixtures/real/<host>__<hash>.html and records the URL in
 * tests/fixtures/real/manifest.json (the URL drives per-source selector routing).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'real');
const MANIFEST_PATH = join(FIXTURES_DIR, 'manifest.json');

interface ManifestEntry {
  url: string;
  fetchedAt: string;
  httpStatus: number;
}

async function main(): Promise<void> {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error('Usage: npx tsx scripts/fetch-fixture.ts <url> [<url> ...]');
    process.exit(1);
  }

  await mkdir(FIXTURES_DIR, { recursive: true });
  const manifest: Record<string, ManifestEntry> = await readManifest();

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          // Browser-like UA: some sites serve bot pages to unknown agents.
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      const html = await response.text();
      const name = fixtureName(url);
      await writeFile(join(FIXTURES_DIR, name), html, 'utf8');
      manifest[name] = { url, fetchedAt: new Date().toISOString(), httpStatus: response.status };
      console.log(`saved ${name} (${response.status}, ${html.length} bytes) <- ${url}`);
    } catch (error) {
      console.error(`FAILED ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`manifest updated: ${MANIFEST_PATH}`);
}

function fixtureName(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9.]/gi, '_');
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
  return `${host}__${hash}.html`;
}

async function readManifest(): Promise<Record<string, ManifestEntry>> {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

main();
