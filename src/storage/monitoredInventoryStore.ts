import { getDatabasePool } from '../db/pool.js';
import { listActiveMonitoredInventory } from '../db/monitored-inventory.js';
import type { Queryable } from '../db/repositories/types.js';
import type { VendorProduct } from '../types/domain.js';

/**
 * Live, process-wide monitored inventory loaded from Postgres. Filter and
 * entity stages refresh from the DB before each run so a Workspace edit
 * takes effect on the next pipeline tick without a restart.
 *
 * The shared pool is used by default; callers may pass an explicit `queryable`
 * for tests. Test code may also pass `inventory` to bypass the DB round-trip
 * with a known fixture.
 */
export async function loadMonitoredInventoryFromDb(
  queryable?: Queryable,
  options: { inventory?: VendorProduct[] } = {}
): Promise<VendorProduct[]> {
  if (options.inventory) {
    return options.inventory;
  }
  const db = queryable ?? getDatabasePool();
  return listActiveMonitoredInventory(db);
}