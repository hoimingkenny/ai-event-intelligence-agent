/**
 * Serves test-source/ as a deterministic local "news site" so the pipeline can
 * be exercised end to end without live, ever-changing RSS data.
 *
 * Usage:
 *   npm run test-source:serve          # http://localhost:8787
 *   PORT=9000 npm run test-source:serve
 *
 * Register the feed once (psql):
 *   INSERT INTO feeds (source_name, feed_url, source_type, trust_level, is_active)
 *   VALUES ('Test Security News', 'http://localhost:8787/feed.xml', 'rss', 'high', true)
 *   ON CONFLICT (feed_url) DO UPDATE SET is_active = true;
 *
 * Then ingest only this feed:
 *   npm run ingest:rss -- --feed-url=http://localhost:8787/feed.xml
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = join(process.cwd(), 'test-source');
const PORT = Number(process.env.PORT ?? 8787);

const CONTENT_TYPES: Record<string, string> = {
  '.xml': 'text/xml; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
  const relative = path === '/' ? '/feed.xml' : path;

  // Prevent path traversal outside test-source/.
  const filePath = join(ROOT, relative);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
    });
    res.end(body);
    console.log(`200 ${relative}`);
  } catch {
    res.writeHead(404).end('not found');
    console.log(`404 ${relative}`);
  }
});

server.listen(PORT, () => {
  console.log(`Test source serving at http://localhost:${PORT}/feed.xml (Ctrl+C to stop)`);
});
