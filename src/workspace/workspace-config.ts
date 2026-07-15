import { FeedRepository, type FeedRecord } from '../db/repositories/feed.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import type { VendorProduct } from '../types/domain.js';

export interface WorkspaceConfigCounts {
  activeFeeds: number;
  activeProducts: number;
}

export type WorkspaceFeedItem = FeedRecord;

export interface WorkspaceInventoryItem {
  id: string;
  vendor: string;
  product: string;
  criticality: VendorProduct['criticality'];
  /** Vendor-level active today (`vendors.is_active`); product-level active arrives in a later ticket. */
  isActive: boolean;
  aliases: string[];
}

interface CountsRow {
  active_feeds: number;
  active_products: number;
}

interface InventoryRow {
  id: string;
  vendor: string;
  product: string;
  criticality: VendorProduct['criticality'];
  is_active: boolean;
  aliases: string[] | null;
}

/**
 * Analyst Workspace Config read model (feeds + monitored inventory).
 * Postgres is the live source for feeds today; inventory fields beyond vendor
 * active / product criticality land in a follow-up ticket.
 */
export async function listWorkspaceFeeds(db: Queryable): Promise<WorkspaceFeedItem[]> {
  return new FeedRepository(db).listAllFeeds();
}

export async function getWorkspaceConfigCounts(db: Queryable): Promise<WorkspaceConfigCounts> {
  const result = await db.query<CountsRow>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM feeds WHERE is_active = true) AS active_feeds,
        (
          SELECT COUNT(*)::int
          FROM vendor_products vp
          JOIN vendors v ON v.id = vp.vendor_id
          WHERE v.is_active = true
        ) AS active_products
    `
  );

  const row = result.rows[0];
  return {
    activeFeeds: row?.active_feeds ?? 0,
    activeProducts: row?.active_products ?? 0,
  };
}

export async function listWorkspaceInventory(db: Queryable): Promise<WorkspaceInventoryItem[]> {
  const result = await db.query<InventoryRow>(
    `
      SELECT
        vp.id,
        v.name AS vendor,
        vp.product_name AS product,
        vp.criticality,
        v.is_active,
        COALESCE(
          array_agg(DISTINCT vpa.alias) FILTER (
            WHERE vpa.alias IS NOT NULL AND lower(vpa.alias) <> lower(vp.product_name)
          ),
          '{}'
        ) AS aliases
      FROM vendor_products vp
      JOIN vendors v ON v.id = vp.vendor_id
      LEFT JOIN vendor_product_aliases vpa ON vpa.product_id = vp.id
      GROUP BY vp.id, v.name, vp.product_name, vp.criticality, v.is_active
      ORDER BY v.name ASC, vp.product_name ASC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    vendor: row.vendor,
    product: row.product,
    criticality: row.criticality,
    isActive: row.is_active,
    aliases: row.aliases ?? [],
  }));
}
