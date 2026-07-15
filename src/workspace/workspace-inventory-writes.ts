import type { PoolClient } from 'pg';
import { getDatabasePool } from '../db/pool.js';
import {
  VendorRepository,
  type Criticality,
  type WorkspaceProductRecord,
} from '../db/repositories/vendor.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import type { VendorProduct } from '../types/domain.js';

export type NewsVolume = VendorProduct['newsVolume'];

export interface CreateProductArgs {
  vendor: string;
  product: string;
  aliases: string[];
  criticality: Criticality;
  newsVolume: NewsVolume;
  isActive: boolean;
}

export interface UpdateProductArgs {
  productId: string;
  productName: string;
  aliases: string[];
  criticality: Criticality;
  newsVolume: NewsVolume;
}

/** Typed failure modes the UI can render verbatim. */
export type InventoryWriteError =
  | 'vendor_required'
  | 'product_required'
  | 'invalid_criticality'
  | 'invalid_news_volume'
  | 'vendor_not_found'
  | 'product_not_found'
  | 'duplicate_product'
  | 'empty_inventory';

export class InventoryWriteFailedError extends Error {
  constructor(public readonly code: InventoryWriteError, message?: string) {
    super(message ?? code);
    this.name = 'InventoryWriteFailedError';
  }
}

const CRITICALITIES: ReadonlyArray<Criticality> = ['low', 'medium', 'high', 'critical'];
const NEWS_VOLUMES: ReadonlyArray<NewsVolume> = ['quiet', 'noisy'];

function trimList(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function ensureCriticality(value: unknown): Criticality {
  if (typeof value === 'string' && (CRITICALITIES as ReadonlyArray<string>).includes(value)) {
    return value as Criticality;
  }
  throw new InventoryWriteFailedError(
    'invalid_criticality',
    `criticality must be one of ${CRITICALITIES.join(', ')}`
  );
}

function ensureNewsVolume(value: unknown): NewsVolume {
  if (typeof value === 'string' && (NEWS_VOLUMES as ReadonlyArray<string>).includes(value)) {
    return value as NewsVolume;
  }
  throw new InventoryWriteFailedError(
    'invalid_news_volume',
    `newsVolume must be one of ${NEWS_VOLUMES.join(', ')}`
  );
}

function ensureNonEmpty(value: string | undefined | null, code: InventoryWriteError): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    throw new InventoryWriteFailedError(code);
  }
  return trimmed;
}

type Pool = {
  connect: () => Promise<PoolClient>;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
};

type PoolClientLike = {
  release: () => void;
};

type Connectable = Queryable & Pool;

function isPool(db: Queryable): db is Connectable {
  const candidate = db as Partial<Pool>;
  return (
    typeof candidate.connect === 'function' &&
    typeof candidate.totalCount === 'number'
  );
}

function isPoolClient(db: Queryable): db is Queryable & PoolClientLike {
  return typeof (db as Partial<PoolClientLike>).release === 'function';
}

async function withTx<T>(db: Queryable, work: (tx: Queryable) => Promise<T>): Promise<T> {
  // Already-checked-out client: caller owns the transaction; use it directly.
  if (isPoolClient(db)) {
    return work(db);
  }
  // Pool: acquire a dedicated client and own the transaction.
  if (isPool(db)) {
    const client = (await db.connect()) as PoolClient;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  // Scripted/standalone: inline BEGIN/COMMIT on the provided queryable.
  await db.query('BEGIN');
  try {
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

/**
 * Add a new monitored product. Vendor is reused if it already exists (we do NOT
 * touch `vendors.is_active`); the product is created with the requested active
 * flag. Reject the operation before any writes if it would leave zero active
 * products, or if the new product would duplicate an existing (vendor, product)
 * pair.
 */
export async function createProduct(
  args: CreateProductArgs,
  queryable: Queryable = getDatabasePool()
): Promise<WorkspaceProductRecord> {
  const vendor = ensureNonEmpty(args.vendor, 'vendor_required');
  const product = ensureNonEmpty(args.product, 'product_required');
  const criticality = ensureCriticality(args.criticality);
  const newsVolume = ensureNewsVolume(args.newsVolume);
  const aliases = trimList(args.aliases);

  return withTx(queryable, async (tx) => {
    const repo = new VendorRepository(tx);

    const activeCount = await repo.countActiveMonitoredProducts();
    if (activeCount === 0 && args.isActive === false) {
      throw new InventoryWriteFailedError('empty_inventory');
    }

    const existingVendor = await repo.findVendorByName(vendor);
    const vendorRow = existingVendor
      ? existingVendor
      : await repo.createVendor({ name: vendor, criticality, isActive: true });

    let created;
    try {
      created = await repo.createProduct({
        vendorId: vendorRow.id,
        productName: product,
        criticality,
        newsVolume,
        isActive: args.isActive,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new InventoryWriteFailedError(
          'duplicate_product',
          `${vendor} / ${product} already exists`
        );
      }
      throw error;
    }

    await repo.replaceProductAliases(created.id, [product, ...aliases]);

    return (await repo.findProductById(created.id))!;
  });
}

/**
 * Edit an existing monitored product. Aliases are replaced (set semantics).
 * Criticality and news volume can change freely. Reject when the new criticality
 * would invalidate the active-product invariant.
 */
export async function updateProduct(
  args: UpdateProductArgs,
  queryable: Queryable = getDatabasePool()
): Promise<WorkspaceProductRecord> {
  const productName = ensureNonEmpty(args.productName, 'product_required');
  const criticality = ensureCriticality(args.criticality);
  const newsVolume = ensureNewsVolume(args.newsVolume);
  const aliases = trimList(args.aliases);

  return withTx(queryable, async (tx) => {
    const repo = new VendorRepository(tx);
    const existing = await repo.findProductById(args.productId);
    if (!existing) {
      throw new InventoryWriteFailedError('product_not_found');
    }
    const row = await repo.updateProduct({
      productId: args.productId,
      productName,
      criticality,
      newsVolume,
    });
    await repo.replaceProductAliases(row.id, [productName, ...aliases]);
    return (await repo.findProductById(row.id))!;
  });
}

/**
 * Soft-deactivate or reactivate a product. Reject if the change would leave
 * zero active monitored products. No hard delete.
 */
export async function setProductActive(
  productId: string,
  isActive: boolean,
  queryable: Queryable = getDatabasePool()
): Promise<WorkspaceProductRecord> {
  return withTx(queryable, async (tx) => {
    const repo = new VendorRepository(tx);
    const existing = await repo.findProductById(productId);
    if (!existing) {
      throw new InventoryWriteFailedError('product_not_found');
    }

    if (!isActive) {
      const activeCount = await repo.countActiveMonitoredProducts();
      if (activeCount <= 1) {
        throw new InventoryWriteFailedError('empty_inventory');
      }
    }

    await repo.setProductActive(productId, isActive);
    return (await repo.findProductById(productId))!;
  });
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '23505';
}