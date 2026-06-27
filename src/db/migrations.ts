import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface MigrationFile {
  name: string;
  sql: string;
}

export const defaultMigrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations'
);

export function sortMigrationNames(names: string[]): string[] {
  return names.filter((name) => name.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
}

export function getPendingMigrationNames(availableNames: string[], appliedNames: string[]): string[] {
  const applied = new Set(appliedNames);
  return sortMigrationNames(availableNames).filter((name) => !applied.has(name));
}

export async function loadMigrationFiles(
  migrationsDir: string = defaultMigrationsDir
): Promise<MigrationFile[]> {
  const names = sortMigrationNames(await readdir(migrationsDir));

  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(join(migrationsDir, name), 'utf8'),
    }))
  );
}
