import type { Queryable } from '../db/repositories/types.js';
import type { VendorProduct } from '../types/domain.js';

interface MonitoredProductRow {
  vendor: string;
  product: string;
  criticality: VendorProduct['criticality'];
  news_volume: VendorProduct['newsVolume'];
  is_active: boolean;
  aliases: string[] | null;
}

/**
 * Active monitored vendor products from Postgres for live pipeline runs.
 *
 * Returns only products whose vendor and the product itself are `is_active = true`,
 * so an inactive product is filtered out for cheap filter / entity stages without
 * mutating the persisted rows.
 */
export async function listActiveMonitoredInventory(db: Queryable): Promise<VendorProduct[]> {
  const result = await db.query<MonitoredProductRow>(
    `
      SELECT
        v.name AS vendor,
        vp.product_name AS product,
        vp.criticality,
        vp.news_volume,
        vp.is_active,
        COALESCE(
          array_agg(DISTINCT vpa.alias) FILTER (
            WHERE vpa.alias IS NOT NULL AND lower(vpa.alias) <> lower(vp.product_name)
          ),
          '{}'
        ) AS aliases
      FROM vendor_products vp
      JOIN vendors v ON v.id = vp.vendor_id
      LEFT JOIN vendor_product_aliases vpa ON vpa.product_id = vp.id
      WHERE v.is_active = true
        AND vp.is_active = true
      GROUP BY v.name, vp.product_name, vp.criticality, vp.news_volume, vp.is_active
      ORDER BY v.name ASC, vp.product_name ASC
    `
  );

  return result.rows.map((row) => ({
    id: deriveId(row.vendor, row.product),
    vendor: row.vendor,
    product: row.product,
    criticality: row.criticality,
    inProduction: row.is_active,
    newsVolume: row.news_volume,
    aliases: row.aliases ?? [],
  }));
}

function deriveId(vendor: string, product: string): string {
  const slug = `${vendor} ${product}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `vp_${slug}`;
}