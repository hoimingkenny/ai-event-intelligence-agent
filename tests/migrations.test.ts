import { describe, expect, it } from 'vitest';
import { getPendingMigrationNames, sortMigrationNames } from '../src/db/migrations.js';

describe('migration helpers', () => {
  it('sorts only SQL migration files by name', () => {
    expect(
      sortMigrationNames(['002_next.sql', 'README.md', '001_core.sql', 'notes.txt'])
    ).toEqual(['001_core.sql', '002_next.sql']);
  });

  it('returns migrations that have not been applied yet', () => {
    expect(
      getPendingMigrationNames(
        ['003_alerts.sql', '001_core.sql', '002_articles.sql'],
        ['001_core.sql']
      )
    ).toEqual(['002_articles.sql', '003_alerts.sql']);
  });
});
