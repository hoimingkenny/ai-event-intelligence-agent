import { env } from '../config/env.js';
import { model } from '../config/llm.js';
import { ArticleRepository } from '../db/repositories/article.repository.js';
import { LlmAuditRepository } from '../db/repositories/llm-audit.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { classifyCyberArticle } from '../llm/cyber-classifier.js';
import type { PipelineProfile } from './profile.js';

export interface DigestStageResult {
  reviewed: number;
  digested: number;
  skipped: number;
  failed: number;
}

export async function runArticleDigestStage(
  db: Queryable,
  options: { limit?: number; profile?: PipelineProfile; includeLlm?: boolean } = {}
): Promise<DigestStageResult> {
  const articles = new ArticleRepository(db);
  const audit = new LlmAuditRepository(db);
  const profile = options.profile ?? 'analyst-eval';
  const includeLlm = options.includeLlm ?? Boolean(env.minimaxApiKey);
  const candidates = await articles.listArticlesNeedingDigest(options.limit ?? 20);

  let digested = 0;
  let skipped = 0;
  let failed = 0;

  if (!includeLlm) {
    return { reviewed: candidates.length, digested: 0, skipped: candidates.length, failed: 0 };
  }

  for (const article of candidates) {
    try {
      const digest = await classifyCyberArticle(article);
      await articles.saveArticleDigest(article.id, digest, {
        terminal: profile === 'analyst-eval',
      });
      await audit.insert({
        targetType: 'article',
        targetId: article.id,
        taskName: 'article_digest',
        model,
        promptVersion: 'cyber-classifier-v1',
        requestJson: { articleId: article.id },
        responseJson: digest,
        validationStatus: 'valid',
      });
      digested += 1;
    } catch (error) {
      await audit.insert({
        targetType: 'article',
        targetId: article.id,
        taskName: 'article_digest',
        model,
        promptVersion: 'cyber-classifier-v1',
        requestJson: { articleId: article.id },
        validationStatus: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      failed += 1;
    }
  }

  return { reviewed: candidates.length, digested, skipped, failed };
}
