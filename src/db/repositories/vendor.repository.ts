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

export interface CreateProductInput {
  vendor: string;
  product: string;
  aliases: string[];
  criticality: Criticality;
  newsVolume: VendorProduct['newsVolume'];
  isActive: boolean;
}

export interface UpdateProductInput {
  productId: string;
  productName: string;
  criticality: Criticality;
  newsVolume: VendorProduct['newsVolume'];
}

export interface WorkspaceProductRecord {
  id: string;
  vendorId: string;
  vendor: string;
  productName: string;
  criticality: Criticality;
  newsVolume: VendorProduct['newsVolume'];
  isActive: boolean;
  aliases: string[];
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

interface WorkspaceProductRow {
  id: string;
  vendor_id: string;
  vendor: string;
  product_name: string;
  criticality: Criticality;
  news_volume: VendorProduct['newsVolume'];
  is_active: boolean;
  aliases: string[] | null;
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

  /** Look up a vendor by exact (case-insensitive) name. Does not require active. */
  async findVendorByName(name: string): Promise<VendorRecord | null> {
    const result = await this.db.query<VendorRow>(
      `
        SELECT id, name, criticality, category, is_active
        FROM vendors
        WHERE lower(name) = lower($1)
        LIMIT 1
      `,
      [name]
    );

    return result.rows[0] ? mapVendor(result.rows[0]) : null;
  }

  /** Insert a new vendor with the given criticality. Throws on duplicate name. */
  async createVendor(input: {
    name: string;
    criticality: Criticality;
    isActive: boolean;
  }): Promise<VendorRecord> {
    const result = await this.db.query<VendorRow>(
      `
        INSERT INTO vendors (name, criticality, is_active, updated_at)
        VALUES ($1, $2, $3, now())
        RETURNING id, name, criticality, category, is_active
      `,
      [input.name, input.criticality, input.isActive]
    );

    return mapVendor(result.rows[0]);
  }

  /** Insert a new product under the given vendor id. Throws on duplicate vendor+product. */
  async createProduct(input: {
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
        RETURNING id, vendor_id, product_name, criticality
      `,
      [input.vendorId, input.productName, input.criticality, input.newsVolume, input.isActive]
    );

    return mapProduct(result.rows[0]);
  }

  /** Find a product by id (no active filter). */
  async findProductById(productId: string): Promise<WorkspaceProductRecord | null> {
    const result = await this.db.query<WorkspaceProductRow>(
      `
        SELECT
          vp.id,
          vp.vendor_id,
          v.name AS vendor,
          vp.product_name,
          vp.criticality,
          vp.news_volume,
          vp.is_active,
          COALESCE(
            array_agg(DISTINCT vpa.alias) FILTER (WHERE vpa.alias IS NOT NULL),
            '{}'
          ) AS aliases
        FROM vendor_products vp
        JOIN vendors v ON v.id = vp.vendor_id
        LEFT JOIN vendor_product_aliases vpa ON vpa.product_id = vp.id
        WHERE vp.id = $1
        GROUP BY vp.id, vp.vendor_id, v.name, vp.product_name, vp.criticality, vp.news_volume, vp.is_active
      `,
      [productId]
    );

    return result.rows[0] ? mapWorkspaceProduct(result.rows[0]) : null;
  }

  /** Update editable fields on a product. Throws when the product is missing. */
  async updateProduct(input: UpdateProductInput): Promise<VendorProductRecord> {
    const result = await this.db.query<ProductRow>(
      `
        UPDATE vendor_products
        SET
          product_name = $2,
          criticality = $3,
          news_volume = $4,
          updated_at = now()
        WHERE id = $1
        RETURNING id, vendor_id, product_name, criticality
      `,
      [input.productId, input.productName, input.criticality, input.newsVolume]
    );

    if (result.rows.length === 0) {
      throw new Error(`vendor product ${input.productId} not found`);
    }

    return mapProduct(result.rows[0]);
  }

  /** Set the product-level active flag. Throws when the product is missing. */
  async setProductActive(productId: string, isActive: boolean): Promise<VendorProductRecord> {
    const result = await this.db.query<ProductRow>(
      `
        UPDATE vendor_products
        SET is_active = $2, updated_at = now()
        WHERE id = $1
        RETURNING id, vendor_id, product_name, criticality
      `,
      [productId, isActive]
    );

    if (result.rows.length === 0) {
      throw new Error(`vendor product ${productId} not found`);
    }

    return mapProduct(result.rows[0]);
  }

  /** Count active monitored products (vendor active AND product active). */
  async countActiveMonitoredProducts(): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM vendor_products vp
        JOIN vendors v ON v.id = vp.vendor_id
        WHERE v.is_active = true AND vp.is_active = true
      `
    );
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  }

  /** Replace the alias set for a product. Product name is always included as a canonical alias. */
  async replaceProductAliases(productId: string, aliases: string[]): Promise<void> {
    const unique = Array.from(new Set([...aliases].map((a) => a.trim()).filter(Boolean)));
    await this.db.query('DELETE FROM vendor_product_aliases WHERE product_id = $1', [productId]);
    for (const alias of unique) {
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

function mapWorkspaceProduct(row: WorkspaceProductRow): WorkspaceProductRecord {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendor: row.vendor,
    productName: row.product_name,
    criticality: row.criticality,
    newsVolume: row.news_volume,
    isActive: row.is_active,
    aliases: row.aliases ?? [],
  };
}
