import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VendorRepository } from '../src/db/repositories/vendor.repository.js';
import {
  InventoryWriteFailedError,
  setProductActive,
} from '../src/workspace/workspace-inventory-writes.js';

const databaseUrl = process.env.DATABASE_URL;
const runId = `wtw_inv_${Date.now()}`;

/**
 * Scripted-DB integration test for #37 inventory writes. Uses a single
 * client + transaction so the test rolls back and never disturbs shared
 * state. Proves that a deactivate that would leave zero active products is
 * rejected without persisting.
 */
describe.skipIf(!databaseUrl)('workspace inventory writes (scripted DB)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.query(
      'DELETE FROM vendor_product_aliases WHERE product_id IN (SELECT id FROM vendor_products WHERE product_name LIKE $1)',
      [`${runId} %`]
    );
    await pool.query('DELETE FROM vendor_products WHERE product_name LIKE $1', [`${runId} %`]);
    await pool.query('DELETE FROM vendors WHERE name = $1', [`${runId} Vendor`]);
    await pool.end();
  });

  it('rejects deactivating the last active product without DB writes', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const vendors = new VendorRepository(client);
      const seeded = await vendors.seedVendorProduct({
        vendor: `${runId} Vendor`,
        product: `${runId} Product A`,
        aliases: [],
        criticality: 'high',
        inProduction: true,
      });
      const seededB = await vendors.seedVendorProduct({
        vendor: `${runId} Vendor`,
        product: `${runId} Product B`,
        aliases: [],
        criticality: 'high',
        inProduction: true,
      });

      // Deactivate every other active product (seeded B + any pre-existing
      // seed data) so that `seeded` is the sole active product.
      const others = await client.query<{ id: string }>(
        `SELECT vp.id FROM vendor_products vp
         JOIN vendors v ON v.id = vp.vendor_id
         WHERE v.is_active = true AND vp.is_active = true
           AND vp.id <> $1`,
        [seeded.id]
      );
      const otherIds = others.rows.map((row) => row.id);
      if (otherIds.length > 0) {
        await client.query(
          'UPDATE vendor_products SET is_active = false WHERE id = ANY($1::bigint[])',
          [otherIds]
        );
      }

      // Confirm we are in the "last active" state we want to test.
      const sanity = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM vendor_products vp
         JOIN vendors v ON v.id = vp.vendor_id
         WHERE v.is_active = true AND vp.is_active = true`
      );
      expect(Number.parseInt(sanity.rows[0].count, 10)).toBe(1);

      // Attempt the forbidden deactivate: must reject with the typed error.
      await expect(setProductActive(seeded.id, false, client)).rejects.toBeInstanceOf(
        InventoryWriteFailedError
      );
      await expect(setProductActive(seeded.id, false, client)).rejects.toMatchObject({
        code: 'empty_inventory',
      });

      // Product must still be active.
      const after = await client.query<{ is_active: boolean }>(
        'SELECT is_active FROM vendor_products WHERE id = $1',
        [seeded.id]
      );
      expect(after.rows[0].is_active).toBe(true);

      // ROLLBACK restores all pre-existing rows we deactivated above.
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});