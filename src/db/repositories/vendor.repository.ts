import type { VendorProduct } from '../../types/domain.js';
import type { Queryable } from './types.js';

export type Criticality = VendorProduct['criticality'];

export interface VendorRecord {
  id: string;
  name: string;
  criticality: Criticality;
  category: string | null;
  isActive: boolean;
}

export interface VendorProductRecord {
  id: string;
  vendorId: string;
  productName: string;
  criticality: Criticality;
}

export interface SeedVendorProductInput {
  vendor: string;
  product: string;
  aliases: string[];
  criticality: Criticality;
  inProduction: boolean;
  newsVolume?: VendorProduct['newsVolume'];
}

interface VendorRow {
  id: string;
  name: string;
  criticality: Criticality;
  category: string | null;
  is_active: boolean;
}

interface ProductRow {
  id: string;
  vendor_id: string;
  product_name: string;
  criticality: Criticality;
}

export class VendorRepository {
  constructor(private readonly db: Queryable) {}

  async seedVendorProduct(input: SeedVendorProductInput): Promise<VendorProductRecord> {
    const vendor = await this.upsertVendor({
      name: input.vendor,
      criticality: input.criticality,
      isActive: input.inProduction,
    });

    await this.upsertVendorAlias(vendor.id, input.vendor, 'canonical');

    const product = await this.upsertProduct({
      vendorId: vendor.id,
      productName: input.product,
      criticality: input.criticality,
      newsVolume: input.newsVolume ?? 'quiet',
      isActive: input.inProduction,
    });

    const aliases = Array.from(new Set([input.product, ...input.aliases]));
    for (const alias of aliases) {
      await this.upsertProductAlias(product.id, alias);
    }

    return product;
  }

  async findActiveVendorByAlias(alias: string): Promise<VendorRecord | null> {
    const result = await this.db.query<VendorRow>(
      `
        SELECT DISTINCT v.id, v.name, v.criticality, v.category, v.is_active
        FROM vendors v
        LEFT JOIN vendor_aliases va ON va.vendor_id = v.id
        WHERE v.is_active = true
          AND (lower(v.name) = lower($1) OR lower(va.alias) = lower($1))
        ORDER BY v.name ASC
        LIMIT 1
      `,
      [alias]
    );

    return result.rows[0] ? mapVendor(result.rows[0]) : null;
  }

  async findProductsByAlias(alias: string): Promise<VendorProductRecord[]> {
    const result = await this.db.query<ProductRow>(
      `
        SELECT DISTINCT vp.id, vp.vendor_id, vp.product_name, vp.criticality
        FROM vendor_products vp
        LEFT JOIN vendor_product_aliases vpa ON vpa.product_id = vp.id
        JOIN vendors v ON v.id = vp.vendor_id
        WHERE v.is_active = true
          AND (lower(vp.product_name) = lower($1) OR lower(vpa.alias) = lower($1))
        ORDER BY vp.product_name ASC
      `,
      [alias]
    );

    return result.rows.map(mapProduct);
  }

  async listActiveVendors(): Promise<VendorRecord[]> {
    const result = await this.db.query<VendorRow>(
      `
        SELECT id, name, criticality, category, is_active
        FROM vendors
        WHERE is_active = true
        ORDER BY name ASC
      `
    );

    return result.rows.map(mapVendor);
  }

  private async upsertVendor(input: {
    name: string;
    criticality: Criticality;
    isActive: boolean;
  }): Promise<VendorRecord> {
    const result = await this.db.query<VendorRow>(
      `
        INSERT INTO vendors (name, criticality, is_active, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (name)
        DO UPDATE SET
          criticality = CASE
            WHEN array_position(ARRAY['low', 'medium', 'high', 'critical'], EXCLUDED.criticality)
              > array_position(ARRAY['low', 'medium', 'high', 'critical'], vendors.criticality)
            THEN EXCLUDED.criticality
            ELSE vendors.criticality
          END,
          is_active = vendors.is_active OR EXCLUDED.is_active,
          updated_at = now()
        RETURNING id, name, criticality, category, is_active
      `,
      [input.name, input.criticality, input.isActive]
    );

    return mapVendor(result.rows[0]);
  }

  private async upsertVendorAlias(
    vendorId: string,
    alias: string,
    aliasType: string | null = null
  ): Promise<void> {
    await this.db.query(
      `
        INSERT INTO vendor_aliases (vendor_id, alias, alias_type)
        VALUES ($1, $2, $3)
        ON CONFLICT (vendor_id, alias) DO UPDATE SET alias_type = EXCLUDED.alias_type
      `,
      [vendorId, alias, aliasType]
    );
  }

  private async upsertProduct(input: {
    vendorId: string;
    productName: string;
    criticality: Criticality;
    newsVolume: VendorProduct['newsVolume'];
    isActive: boolean;
  }): Promise<VendorProductRecord> {
    const result = await this.db.query<ProductRow>(
      `
        INSERT INTO vendor_products (vendor_id, product_name, criticality, news_volume, is_active, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (vendor_id, product_name)
        DO UPDATE SET
          criticality = CASE
            WHEN array_position(ARRAY['low', 'medium', 'high', 'critical'], EXCLUDED.criticality)
              > array_position(ARRAY['low', 'medium', 'high', 'critical'], vendor_products.criticality)
            THEN EXCLUDED.criticality
            ELSE vendor_products.criticality
          END,
          news_volume = EXCLUDED.news_volume,
          is_active = vendor_products.is_active OR EXCLUDED.is_active,
          updated_at = now()
        RETURNING id, vendor_id, product_name, criticality
      `,
      [input.vendorId, input.productName, input.criticality, input.newsVolume, input.isActive]
    );

    return mapProduct(result.rows[0]);
  }

  private async upsertProductAlias(productId: string, alias: string): Promise<void> {
    await this.db.query(
      `
        INSERT INTO vendor_product_aliases (product_id, alias)
        VALUES ($1, $2)
        ON CONFLICT (product_id, alias) DO NOTHING
      `,
      [productId, alias]
    );
  }
}

function mapVendor(row: VendorRow): VendorRecord {
  return {
    id: row.id,
    name: row.name,
    criticality: row.criticality,
    category: row.category,
    isActive: row.is_active,
  };
}

function mapProduct(row: ProductRow): VendorProductRecord {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    productName: row.product_name,
    criticality: row.criticality,
  };
}
