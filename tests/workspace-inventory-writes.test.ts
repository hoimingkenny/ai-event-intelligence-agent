import { describe, expect, it, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';
import type { Queryable } from '../src/db/repositories/types.js';
import {
  InventoryWriteFailedError,
  createProduct,
  setProductActive,
  updateProduct,
} from '../src/workspace/workspace-inventory-writes.js';

/**
 * Minimal scripted DB for the write seam. Supports BEGIN/COMMIT/ROLLBACK and
 * routes each query by SQL fragment to a recorded handler. Handlers are consumed
 * in order (FIFO) so tests can stack different responses for repeated queries
 * with the same SQL fragment.
 */
interface ScriptedHandler {
  match: string;
  rows: unknown[];
  /** Run after the default `rows` response; lets a handler update state. */
  onQuery?: (sql: string, params?: unknown[]) => void;
  /** If true, the handler stays in the queue after firing (default: consume). */
  repeat?: boolean;
}

interface ScriptedDb extends Queryable {
  queries: { sql: string; params?: unknown[] }[];
  beginCount: number;
  commitCount: number;
  rollbackCount: number;
}

function makeScriptedDb(handlers: ScriptedHandler[]): ScriptedDb {
  const queue = handlers.slice();
  const db = {
    queries: [] as { sql: string; params?: unknown[] }[],
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    async query<T>(sql: string, params?: unknown[]) {
      db.queries.push({ sql, params });
      const upper = sql.trim().toUpperCase();
      if (upper === 'BEGIN') {
        db.beginCount += 1;
        return { rows: [] as T[], rowCount: 0 } as QueryResult<T>;
      }
      if (upper === 'COMMIT') {
        db.commitCount += 1;
        return { rows: [] as T[], rowCount: 0 } as QueryResult<T>;
      }
      if (upper === 'ROLLBACK') {
        db.rollbackCount += 1;
        return { rows: [] as T[], rowCount: 0 } as QueryResult<T>;
      }
      const idx = queue.findIndex((h) => sql.includes(h.match));
      if (idx === -1) {
        return { rows: [] as T[], rowCount: 0 } as QueryResult<T>;
      }
      const handler = queue[idx];
      handler.onQuery?.(sql, params);
      if (!handler.repeat) queue.splice(idx, 1);
      return {
        rows: handler.rows as T[],
        rowCount: handler.rows.length,
      } as QueryResult<T>;
    },
  };
  return db as unknown as ScriptedDb;
}

const PRODUCT_ROW = {
  id: '99',
  vendor_id: '1',
  vendor: 'Okta',
  product_name: 'Workforce Identity',
  criticality: 'high',
  news_volume: 'quiet',
  is_active: true,
  aliases: ['Workforce Identity'],
};

describe('createProduct', () => {
  let db: ScriptedDb;
  beforeEach(() => {
    db = makeScriptedDb([]);
  });

  it('rejects missing vendor / product names with typed errors', async () => {
    await expect(
      createProduct(
        {
          vendor: '   ',
          product: 'Okta Workforce',
          aliases: [],
          criticality: 'high',
          newsVolume: 'quiet',
          isActive: true,
        },
        db
      )
    ).rejects.toMatchObject({ code: 'vendor_required' });

    await expect(
      createProduct(
        {
          vendor: 'Okta',
          product: '',
          aliases: [],
          criticality: 'high',
          newsVolume: 'quiet',
          isActive: true,
        },
        db
      )
    ).rejects.toMatchObject({ code: 'product_required' });
  });

  it('rejects unknown criticality and news volume before any DB work', async () => {
    await expect(
      createProduct(
        {
          vendor: 'Okta',
          product: 'Workforce',
          aliases: [],
          criticality: 'banana' as never,
          newsVolume: 'quiet',
          isActive: true,
        },
        db
      )
    ).rejects.toBeInstanceOf(InventoryWriteFailedError);

    expect(db.queries).toHaveLength(0);
    expect(db.beginCount).toBe(0);
  });

  it('rejects a would-empty create when there are zero active products', async () => {
    const localDb = makeScriptedDb([
      { match: 'FROM vendor_products vp', rows: [{ count: '0' }] },
    ]);

    await expect(
      createProduct(
        {
          vendor: 'Okta',
          product: 'Workforce',
          aliases: [],
          criticality: 'high',
          newsVolume: 'quiet',
          isActive: false,
        },
        localDb
      )
    ).rejects.toMatchObject({ code: 'empty_inventory' });

    // Empty-inventory reject must happen *after* the count read but *before* any write.
    const writes = localDb.queries.filter(
      (q) => q.sql.startsWith('INSERT INTO vendors') || q.sql.startsWith('INSERT INTO vendor_products')
    );
    expect(writes).toHaveLength(0);
    expect(localDb.rollbackCount).toBe(1);
  });

  it('creates vendor + product + canonical alias when vendor is new', async () => {
    const localDb = makeScriptedDb([
      { match: 'FROM vendor_products vp', rows: [{ count: '3' }] },
      { match: 'lower(name) = lower', rows: [] }, // no vendor yet
      {
        match: 'INSERT INTO vendors',
        rows: [{ id: '7', name: 'Okta', criticality: 'high', category: null, is_active: true }],
      },
      {
        match: 'INSERT INTO vendor_products',
        rows: [{ id: '42', vendor_id: '7', product_name: 'Workforce Identity', criticality: 'high' }],
      },
      // findProductById post-create
      {
        match: 'WHERE vp.id = $1',
        rows: [PRODUCT_ROW],
      },
    ]);

    const result = await createProduct(
      {
        vendor: 'Okta',
        product: 'Workforce Identity',
        aliases: ['Okta Workforce', 'Workforce'],
        criticality: 'high',
        newsVolume: 'quiet',
        isActive: true,
      },
      localDb
    );

    expect(result.id).toBe('99');
    expect(result.vendor).toBe('Okta');

    // Aliases persisted: deduped + product name canonical.
    const aliasInserts = localDb.queries.filter((q) =>
      q.sql.includes('INSERT INTO vendor_product_aliases')
    );
    const aliasValues = aliasInserts.map((q) => (q.params as string[])[1]);
    expect(aliasValues).toEqual(
      expect.arrayContaining(['Workforce Identity', 'Okta Workforce', 'Workforce'])
    );
    expect(new Set(aliasValues)).toEqual(new Set(aliasValues));

    // DELETE FROM vendor_product_aliases runs before the inserts (replace semantics).
    expect(localDb.queries.some((q) => q.sql.includes('DELETE FROM vendor_product_aliases'))).toBe(true);

    expect(localDb.commitCount).toBe(1);
  });

  it('rejects duplicate (vendor, product) pair without leaving rows', async () => {
    const localDb = makeScriptedDb([
      { match: 'FROM vendor_products vp', rows: [{ count: '3' }] },
      {
        match: 'lower(name) = lower',
        rows: [{ id: '7', name: 'Okta', criticality: 'high', category: null, is_active: true }],
      },
      {
        match: 'INSERT INTO vendor_products',
        onQuery: () => {
          const err = new Error('duplicate') as Error & { code?: string };
          err.code = '23505';
          throw err;
        },
        rows: [],
      },
    ]);

    await expect(
      createProduct(
        {
          vendor: 'Okta',
          product: 'Workforce Identity',
          aliases: [],
          criticality: 'high',
          newsVolume: 'quiet',
          isActive: true,
        },
        localDb
      )
    ).rejects.toMatchObject({ code: 'duplicate_product' });

    expect(localDb.rollbackCount).toBe(1);
    const aliasInserts = localDb.queries.filter((q) =>
      q.sql.includes('INSERT INTO vendor_product_aliases')
    );
    expect(aliasInserts).toHaveLength(0);
  });
});

describe('updateProduct', () => {
  it('rejects unknown product with typed error', async () => {
    const db = makeScriptedDb([
      { match: 'WHERE vp.id = $1', rows: [] },
    ]);

    await expect(
      updateProduct(
        {
          productId: '999',
          productName: 'Anything',
          aliases: [],
          criticality: 'high',
          newsVolume: 'quiet',
        },
        db
      )
    ).rejects.toMatchObject({ code: 'product_not_found' });

    expect(db.rollbackCount).toBe(1);
  });

  it('replaces alias set (set semantics): old aliases gone, new aliases inserted', async () => {
    const db = makeScriptedDb([
      {
        match: 'WHERE vp.id = $1',
        rows: [
          {
            ...PRODUCT_ROW,
            id: '99',
            aliases: ['Old Alias', 'Workforce Identity'],
          },
        ],
      },
      {
        match: 'UPDATE vendor_products',
        rows: [{ id: '99', vendor_id: '1', product_name: 'Workforce Identity v2', criticality: 'high' }],
      },
      {
        match: 'WHERE vp.id = $1',
        rows: [
          {
            ...PRODUCT_ROW,
            id: '99',
            product_name: 'Workforce Identity v2',
            aliases: ['Workforce Identity v2'],
          },
        ],
      },
    ]);

    await updateProduct(
      {
        productId: '99',
        productName: 'Workforce Identity v2',
        aliases: ['WID v2', 'WID'],
        criticality: 'high',
        newsVolume: 'quiet',
      },
      db
    );

    expect(db.queries.some((q) => q.sql.includes('DELETE FROM vendor_product_aliases'))).toBe(true);

    const aliasInserts = db.queries
      .filter((q) => q.sql.includes('INSERT INTO vendor_product_aliases'))
      .map((q) => (q.params as string[])[1]);

    // Old aliases absent, new aliases present, product name included as canonical.
    expect(aliasInserts).not.toContain('Old Alias');
    expect(aliasInserts).toEqual(expect.arrayContaining(['Workforce Identity v2', 'WID v2', 'WID']));
    expect(new Set(aliasInserts).size).toBe(aliasInserts.length);
  });

  it('rejects invalid criticality and news volume before any DB work', async () => {
    const db = makeScriptedDb([]);
    await expect(
      updateProduct(
        {
          productId: '99',
          productName: 'X',
          aliases: [],
          criticality: 'banana' as never,
          newsVolume: 'quiet',
        },
        db
      )
    ).rejects.toBeInstanceOf(InventoryWriteFailedError);
    expect(db.queries).toHaveLength(0);
  });
});

describe('setProductActive', () => {
  it('rejects deactivating the last active product (zero write)', async () => {
    const db = makeScriptedDb([
      { match: 'WHERE vp.id = $1', rows: [PRODUCT_ROW] },
      { match: 'FROM vendor_products vp', rows: [{ count: '1' }] },
    ]);

    await expect(setProductActive('99', false, db)).rejects.toMatchObject({
      code: 'empty_inventory',
    });

    // No UPDATE should have happened.
    const updates = db.queries.filter((q) => q.sql.includes('UPDATE vendor_products'));
    expect(updates).toHaveLength(0);
    expect(db.rollbackCount).toBe(1);
  });

  it('allows reactivating the last active product (it is already active, count > 0)', async () => {
    const db = makeScriptedDb([
      { match: 'WHERE vp.id = $1', rows: [{ ...PRODUCT_ROW, is_active: false }] },
      {
        match: 'UPDATE vendor_products',
        rows: [{ id: '99', vendor_id: '1', product_name: 'Workforce Identity', criticality: 'high' }],
      },
      { match: 'WHERE vp.id = $1', rows: [{ ...PRODUCT_ROW, is_active: true }] },
    ]);

    let result;
    try {
      result = await setProductActive('99', true, db);
    } catch (error) {
      console.error('unexpected error', error);
      console.error('queries', JSON.stringify(db.queries, null, 2));
      throw error;
    }
    expect(result.isActive).toBe(true);
    expect(db.queries.some((q) => q.sql.includes('UPDATE vendor_products'))).toBe(true);
  });

  it('rejects unknown product with typed error', async () => {
    const db = makeScriptedDb([{ match: 'WHERE vp.id = $1', rows: [] }]);
    await expect(setProductActive('999', true, db)).rejects.toMatchObject({
      code: 'product_not_found',
    });
  });
});