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
    // Pass fields separately so zoned confidence scoring can weight by
    // placement (title/lead strong, tail weak) — see entity-confidence.ts.
    const extracted = extractArticleEntities(article.id, {
      title: article.title,
      summary: article.rssSummary,
      body: article.cleanText,
    });

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
