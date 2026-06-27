import type { Queryable } from './types.js';

export interface ArticleEntityInput {
  articleId: string;
  entityType: string;
  entityValue: string;
  confidence?: number | null;
  role?: string | null;
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
}
