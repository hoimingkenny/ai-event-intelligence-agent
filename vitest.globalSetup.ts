import 'dotenv/config';
import pg from 'pg';
import { loadMigrationFiles } from './src/db/migrations.js';

// Isolate DB-backed tests from the developer's `app` schema (real backlog data)
// by running them against a throwaway `app_test` schema that is dropped, recreated,
// and migrated fresh on every `npm test` run. pgvector stays in `public` and is
// shared. If Postgres is unreachable, we leave DATABASE_URL untouched so tests keep
// their graceful `skipIf(!databaseUrl)` behavior.
const TEST_SCHEMA = 'app_test';

function withTestSchema(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.delete('options');
  const base = url.toString();
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}options=-c%20search_path%3D${schema}%2Cpublic`;
}

export default async function setup(): Promise<() => Promise<void>> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) return async () => undefined;

  const adminPool = new pg.Pool({ connectionString: baseUrl });
  try {
    await adminPool.query('SELECT 1');
  } catch {
    await adminPool.end().catch(() => undefined);
    return async () => undefined;
  }

  const client = await adminPool.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const migrations = await loadMigrationFiles();
    for (const migration of migrations) {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Test migration ${migration.name} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    client.release();
    await adminPool.end().catch(() => undefined);
  }

  // Point every DB-backed test at the fresh schema. Workers are forked after this
  // runs, so they inherit the updated env.
  process.env.DATABASE_URL = withTestSchema(baseUrl, TEST_SCHEMA);

  return async () => {
    const teardownPool = new pg.Pool({ connectionString: baseUrl });
    try {
      await teardownPool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    } catch {
      /* best-effort cleanup */
    } finally {
      await teardownPool.end().catch(() => undefined);
    }
  };
}
