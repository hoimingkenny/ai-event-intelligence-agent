import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

let sharedPool: pg.Pool | null = null;

export function createPool(databaseUrl: string = env.databaseUrl): pg.Pool {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for database-backed commands.');
  }

  return new Pool({
    connectionString: databaseUrl,
  });
}

export function getDatabasePool(): pg.Pool {
  if (!sharedPool) {
    sharedPool = createPool();
  }

  return sharedPool;
}

export async function closeDatabasePool(): Promise<void> {
  if (!sharedPool) return;
  await sharedPool.end();
  sharedPool = null;
}
