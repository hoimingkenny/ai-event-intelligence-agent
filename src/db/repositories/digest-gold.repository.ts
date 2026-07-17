import type { Queryable } from './types.js';
import type {
  DigestGoldArticleSnapshot,
  DigestGoldFields,
  DigestGoldInventorySnapshot,
  DigestGoldLabelRecord,
} from '../../evaluation/digest/digest-gold-types.js';

interface DigestGoldRow {
  id: string;
  article_id: string;
  related_to_monitored_inventory: boolean;
  matched_vendors: string[];
  matched_products: string[];
  cves: string[];
  human_reason: string | null;
  article_snapshot: DigestGoldArticleSnapshot;
  inventory_snapshot: DigestGoldInventorySnapshot;
  labeled_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DigestGoldUpsertInput extends DigestGoldFields {
  articleId: string;
  articleSnapshot: DigestGoldArticleSnapshot;
  inventorySnapshot: DigestGoldInventorySnapshot;
  labeledBy?: string | null;
}

export interface DigestGoldQueueArticle {
  id: string;
  title: string | null;
  sourceName: string | null;
  canonicalUrl: string | null;
  publishedAt: Date | null;
  digestRelated: boolean | null;
}

export interface DigestGoldLabeledArticle extends DigestGoldQueueArticle {
  relatedToMonitoredInventory: boolean;
  labeledAt: Date;
}

function mapRow(row: DigestGoldRow): DigestGoldLabelRecord {
  return {
    id: row.id,
    articleId: row.article_id,
    relatedToMonitoredInventory: row.related_to_monitored_inventory,
    matchedVendors: row.matched_vendors ?? [],
    matchedProducts: row.matched_products ?? [],
    cves: row.cves ?? [],
    humanReason: row.human_reason,
    articleSnapshot: row.article_snapshot,
    inventorySnapshot: row.inventory_snapshot,
    labeledBy: row.labeled_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DigestGoldRepository {
  constructor(private readonly db: Queryable) {}

  async findByArticleId(articleId: string): Promise<DigestGoldLabelRecord | null> {
    const result = await this.db.query<DigestGoldRow>(
      `
        SELECT id, article_id, related_to_monitored_inventory, matched_vendors,
          matched_products, cves, human_reason, article_snapshot, inventory_snapshot,
          labeled_by, created_at, updated_at
        FROM digest_gold_labels
        WHERE article_id = $1
      `,
      [articleId]
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async countLabels(): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM digest_gold_labels`
    );
    return result.rows[0]?.count ?? 0;
  }

  async upsert(input: DigestGoldUpsertInput): Promise<DigestGoldLabelRecord> {
    const result = await this.db.query<DigestGoldRow>(
      `
        INSERT INTO digest_gold_labels (
          article_id,
          related_to_monitored_inventory,
          matched_vendors,
          matched_products,
          cves,
          human_reason,
          article_snapshot,
          inventory_snapshot,
          labeled_by,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, now())
        ON CONFLICT (article_id) DO UPDATE SET
          related_to_monitored_inventory = EXCLUDED.related_to_monitored_inventory,
          matched_vendors = EXCLUDED.matched_vendors,
          matched_products = EXCLUDED.matched_products,
          cves = EXCLUDED.cves,
          human_reason = EXCLUDED.human_reason,
          article_snapshot = EXCLUDED.article_snapshot,
          inventory_snapshot = EXCLUDED.inventory_snapshot,
          labeled_by = EXCLUDED.labeled_by,
          updated_at = now()
        RETURNING id, article_id, related_to_monitored_inventory, matched_vendors,
          matched_products, cves, human_reason, article_snapshot, inventory_snapshot,
          labeled_by, created_at, updated_at
      `,
      [
        input.articleId,
        input.relatedToMonitoredInventory,
        input.matchedVendors,
        input.matchedProducts,
        input.cves,
        input.humanReason,
        JSON.stringify(input.articleSnapshot),
        JSON.stringify(input.inventorySnapshot),
        input.labeledBy ?? null,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('digest gold upsert returned no row');
    }
    return mapRow(row);
  }

  async listCandidates(options: { limit?: number; offset?: number } = {}): Promise<DigestGoldQueueArticle[]> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const result = await this.db.query<{
      id: string;
      title: string | null;
      source_name: string | null;
      canonical_url: string | null;
      published_at: Date | null;
      llm_article_digest: { relatedToMonitoredInventory?: boolean } | null;
    }>(
      `
        SELECT a.id, a.title, a.source_name, a.canonical_url, a.published_at, a.llm_article_digest
        FROM articles a
        LEFT JOIN digest_gold_labels g ON g.article_id = a.id
        WHERE a.processing_status = 'DIGESTED'
          AND g.id IS NULL
        ORDER BY a.published_at DESC NULLS LAST, a.id DESC
        LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      sourceName: row.source_name,
      canonicalUrl: row.canonical_url,
      publishedAt: row.published_at,
      digestRelated:
        typeof row.llm_article_digest?.relatedToMonitoredInventory === 'boolean'
          ? row.llm_article_digest.relatedToMonitoredInventory
          : null,
    }));
  }

  async listLabeled(options: { limit?: number; offset?: number } = {}): Promise<DigestGoldLabeledArticle[]> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const result = await this.db.query<{
      id: string;
      title: string | null;
      source_name: string | null;
      canonical_url: string | null;
      published_at: Date | null;
      related_to_monitored_inventory: boolean;
      updated_at: Date;
    }>(
      `
        SELECT a.id, a.title, a.source_name, a.canonical_url, a.published_at,
          g.related_to_monitored_inventory, g.updated_at
        FROM digest_gold_labels g
        JOIN articles a ON a.id = g.article_id
        ORDER BY g.updated_at DESC
        LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      sourceName: row.source_name,
      canonicalUrl: row.canonical_url,
      publishedAt: row.published_at,
      digestRelated: null,
      relatedToMonitoredInventory: row.related_to_monitored_inventory,
      labeledAt: row.updated_at,
    }));
  }
}
