import { model } from '../config/llm.js';
import { ArticleRepository } from '../db/repositories/article.repository.js';
import { EventRepository } from '../db/repositories/event.repository.js';
import { LlmAuditRepository } from '../db/repositories/llm-audit.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { rollUpEventAssessment } from '../events/event-assessment.js';
import { classifyCyberArticle } from '../llm/cyber-classifier.js';

export interface ClassificationStageResult {
  reviewed: number;
  classified: number;
  failed: number;
  eventsUpdated: number;
}

export async function runClassificationStage(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<ClassificationStageResult> {
  const articles = new ArticleRepository(db);
  const events = new EventRepository(db);
  const audit = new LlmAuditRepository(db);
  const candidates = await articles.listByProcessingStatus('GROUPED', options.limit ?? 20);
  let classified = 0;
  let failed = 0;
  let eventsUpdated = 0;

  for (const article of candidates) {
    try {
      const classification = await classifyCyberArticle(article);
      await articles.saveClassification(article.id, classification);

      // Feed the verdict back into the event assessment (replaces the
      // hardcoded confidence the event was created with).
      for (const event of await events.listEventsForArticle(article.id)) {
        const sourceCount = await events.getSourceCount(event.id);
        const assessment = rollUpEventAssessment(event, classification, sourceCount);
        await events.updateEventAssessment(event.id, assessment);
        eventsUpdated += 1;
      }
      await audit.insert({
        targetType: 'article',
        targetId: article.id,
        taskName: 'cyber_classification',
        model,
        promptVersion: 'cyber-classifier-v1',
        requestJson: { articleId: article.id },
        responseJson: classification,
        validationStatus: 'valid',
      });
      classified += 1;
    } catch (error) {
      await audit.insert({
        targetType: 'article',
        targetId: article.id,
        taskName: 'cyber_classification',
        model,
        promptVersion: 'cyber-classifier-v1',
        requestJson: { articleId: article.id },
        validationStatus: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      failed += 1;
    }
  }

  return { reviewed: candidates.length, classified, failed, eventsUpdated };
}
