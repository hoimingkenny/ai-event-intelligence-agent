import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import {
  getWorkspaceConfigCounts,
  listWorkspaceFeeds,
  listWorkspaceInventory,
} from '../src/workspace/workspace-config.js';

function scriptedDb(
  handlers: Array<{ match: string; rows: unknown[]; onQuery?: (sql: string, params?: unknown[]) => void }>
): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const handler = handlers.find((h) => sql.includes(h.match));
      handler?.onQuery?.(sql, params);
      return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows.length ?? 0 };
    },
  } as Queryable;
}

describe('workspace config', () => {
  it('lists all feeds including inactive, with full fields', async () => {
    const fetched = new Date('2026-07-15T10:00:00Z');
    const db = scriptedDb([
      {
        match: 'FROM feeds',
        rows: [
          {
            id: '1',
            source_name: 'Krebs on Security',
            feed_url: 'https://krebsonsecurity.com/feed/',
            source_type: 'rss',
            trust_level: 'medium',
            is_active: true,
            last_fetched_at: fetched,
          },
          {
            id: '2',
            source_name: 'MSRC',
            feed_url: 'https://api.msrc.microsoft.com/update-guide/rss',
            source_type: 'rss',
            trust_level: 'high',
            is_active: false,
            last_fetched_at: null,
          },
        ],
      },
    ]);

    const feeds = await listWorkspaceFeeds(db);

    expect(feeds).toHaveLength(2);
    expect(feeds[0]).toEqual({
      id: '1',
      sourceName: 'Krebs on Security',
      feedUrl: 'https://krebsonsecurity.com/feed/',
      sourceType: 'rss',
      trustLevel: 'medium',
      isActive: true,
      lastFetchedAt: fetched,
    });
    expect(feeds[1].isActive).toBe(false);
    expect(feeds[1].lastFetchedAt).toBeNull();
  });

  it('counts active feeds and active monitored vendor products', async () => {
    const db = scriptedDb([
      {
        match: 'AS active_feeds',
        rows: [{ active_feeds: 3, active_products: 5 }],
      },
    ]);

    const counts = await getWorkspaceConfigCounts(db);

    expect(counts).toEqual({ activeFeeds: 3, activeProducts: 5 });
  });

  it('lists inventory products with aliases and vendor active state', async () => {
    const db = scriptedDb([
      {
        match: 'FROM vendor_products',
        rows: [
          {
            id: '10',
            vendor: 'CyberArk',
            product: 'Privileged Access Security',
            criticality: 'critical',
            is_active: true,
            aliases: ['CyberArk PAS', 'PAS'],
          },
          {
            id: '11',
            vendor: 'Okta',
            product: 'Workforce Identity',
            criticality: 'high',
            is_active: false,
            aliases: ['Okta'],
          },
        ],
      },
    ]);

    const items = await listWorkspaceInventory(db);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: '10',
      vendor: 'CyberArk',
      product: 'Privileged Access Security',
      criticality: 'critical',
      isActive: true,
      aliases: ['CyberArk PAS', 'PAS'],
    });
    expect(items[1].isActive).toBe(false);
  });
});
