import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import { listActiveMonitoredInventory } from '../src/db/monitored-inventory.js';

function scriptedDb(
  handlers: Array<{ match: string; rows: unknown[] }>
): Queryable {
  return {
    async query<T>(sql: string) {
      const handler = handlers.find((h) => sql.includes(h.match));
      return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows.length ?? 0 };
    },
  } as Queryable;
}

describe('listActiveMonitoredInventory', () => {
  it('returns active vendor products with aliases, news volume, criticality', async () => {
    const db = scriptedDb([
      {
        match: 'FROM vendor_products vp',
        rows: [
          {
            vendor: 'CyberArk',
            product: 'Privileged Access Security',
            criticality: 'critical',
            news_volume: 'quiet',
            is_active: true,
            aliases: ['CyberArk PAS', 'PAS'],
          },
          {
            vendor: 'Microsoft',
            product: 'Windows Server',
            criticality: 'high',
            news_volume: 'noisy',
            is_active: true,
            aliases: ['Windows Server'],
          },
        ],
      },
    ]);

    const items = await listActiveMonitoredInventory(db);

    expect(items).toEqual([
      {
        id: 'vp_cyberark_privileged_access_security',
        vendor: 'CyberArk',
        product: 'Privileged Access Security',
        criticality: 'critical',
        newsVolume: 'quiet',
        inProduction: true,
        aliases: ['CyberArk PAS', 'PAS'],
      },
      {
        id: 'vp_microsoft_windows_server',
        vendor: 'Microsoft',
        product: 'Windows Server',
        criticality: 'high',
        newsVolume: 'noisy',
        inProduction: true,
        aliases: ['Windows Server'],
      },
    ]);
  });

  it('returns no rows when nothing is active', async () => {
    const db = scriptedDb([{ match: 'FROM vendor_products vp', rows: [] }]);
    const items = await listActiveMonitoredInventory(db);
    expect(items).toEqual([]);
  });
});