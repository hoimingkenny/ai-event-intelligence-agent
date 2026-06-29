import type { PoolClient } from 'pg';
import { getDatabasePool } from '../src/db/pool.js';
import { getPendingMigrationNames, loadMigrationFiles } from '../src/db/migrations.js';

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrationNames(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY name ASC'
  );
  return result.rows.map((row) => row.name);
}

async function main(): Promise<void> {
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);

    const migrations = await loadMigrationFiles();
    const appliedNames = await getAppliedMigrationNames(client);
    const pendingNames = getPendingMigrationNames(
      migrations.map((migration) => migration.name),
      appliedNames
    );
    const pending = migrations.filter((migration) => pendingNames.includes(migration.name));

    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    for (const migration of pending) {
      console.log(`Applying migration ${migration.name}`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
