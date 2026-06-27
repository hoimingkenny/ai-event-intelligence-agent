import type { Queryable } from './types.js';

export interface ArticleEntityInput {
  articleId: string;
  entityType: string;
  entityValue: string;
  confidence?: number | null;
  role?: string | null;
}

export interface ArticleEntityRecord extends ArticleEntityInput {
  id: string;
}

interface EntityRow {
  id: string;
  article_id: string;
  entity_type: string;
  entity_value: string;
  confidence: string | null;
  role: string | null;
}

export class EntityRepository {
  constructor(private readonly db: Queryable) {}

  async addArticleEntity(input: ArticleEntityInput): Promise<void> {
    await this.db.query(
      `
        INSERT INTO article_entities (article_id, entity_type, entity_value, confidence, role)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (article_id, entity_type, entity_value, role)
        DO UPDATE SET confidence = EXCLUDED.confidence
      `,
      [
        input.articleId,
        input.entityType,
        input.entityValue,
        input.confidence ?? null,
        input.role ?? null,
      ]
    );
  }

  async listForArticle(articleId: string): Promise<ArticleEntityRecord[]> {
    const result = await this.db.query<EntityRow>(
      `
        SELECT id, article_id, entity_type, entity_value, confidence, role
        FROM article_entities
        WHERE article_id = $1
        ORDER BY entity_type ASC, entity_value ASC
      `,
      [articleId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      articleId: row.article_id,
      entityType: row.entity_type,
      entityValue: row.entity_value,
      confidence: row.confidence === null ? null : Number(row.confidence),
      role: row.role,
    }));
  }
}
