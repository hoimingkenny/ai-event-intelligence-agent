import { ArticleRepository } from '../db/repositories/article.repository.js';
import { EntityRepository } from '../db/repositories/entity.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { extractArticleEntities } from '../detection/entity-extractor.js';

export interface EntityStageResult {
  reviewed: number;
  entityRows: number;
}

export async function runEntityStage(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<EntityStageResult> {
  const articles = new ArticleRepository(db);
  const entities = new EntityRepository(db);
  const candidates = await articles.listByProcessingStatus('EXTRACTION_SUCCESS', options.limit ?? 50);
  let entityRows = 0;

  for (const article of candidates) {
    const text = [article.title, article.rssSummary, article.cleanText].filter(Boolean).join('\n');
    const extracted = extractArticleEntities(article.id, text);

    for (const entity of extracted) {
      await entities.addArticleEntity(entity);
      entityRows += 1;
    }

    await articles.updateProcessingStatus(article.id, 'ENTITY_EXTRACTED');
  }

  return {
    reviewed: candidates.length,
    entityRows,
  };
}
