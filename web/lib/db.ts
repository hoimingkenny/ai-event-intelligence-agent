import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Queryable } from '../../src/db/repositories/types.js';

const { Pool } = pg;

const webDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(webDir, '../../.env') });
loadEnv({ path: path.join(webDir, '../.env.local'), override: true });

let sharedPool: pg.Pool | null = null;

export function getDb(): Queryable {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for the public catalogue.');
  }
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: databaseUrl });
  }
  return sharedPool;
}
