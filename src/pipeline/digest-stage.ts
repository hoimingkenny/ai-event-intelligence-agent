import { env } from '../config/env.js';
import { model } from '../config/llm.js';
import { ArticleRepository } from '../db/repositories/article.repository.js';
import { LlmAuditRepository } from '../db/repositories/llm-audit.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import {
  ARTICLE_DIGEST_PROMPT_VERSION,
  digestArticleAgainstInventory,
} from '../llm/article-digest.js';
import { loadMonitoredInventoryFromDb } from '../storage/monitoredInventoryStore.js';
import type { VendorProduct } from '../types/domain.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import type { PipelineProfile } from './profile.js';

export interface DigestStageResult {
  reviewed: number;
  digested: number;
  skipped: number;
  failed: number;
}

export async function runArticleDigestStage(
  db: Queryable,
  options: {
    limit?: number;
    profile?: PipelineProfile;
    includeLlm?: boolean;
    concurrency?: number;
    inventory?: VendorProduct[];
  } = {}
): Promise<DigestStageResult> {
  const articles = new ArticleRepository(db);
  const audit = new LlmAuditRepository(db);
  const profile = options.profile ?? 'analyst-eval';
  const includeLlm = options.includeLlm ?? Boolean(env.minimaxApiKey);
  const concurrency = options.concurrency ?? env.llmConcurrency;
  const candidates = await articles.listArticlesNeedingDigest(options.limit ?? 20);
  const inventory =
    options.inventory ?? (await loadMonitoredInventoryFromDb(db));

  let digested = 0;
  let skipped = 0;
  let failed = 0;

  if (!includeLlm) {
    return { reviewed: candidates.length, digested: 0, skipped: candidates.length, failed: 0 };
  }

  await runWithConcurrency(candidates, concurrency, async (article) => {
    await articles.claimArticleForDigest(article.id);
    try {
      const digest = await digestArticleAgainstInventory(article, inventory);
      await articles.saveArticleDigest(article.id, digest, {
        terminal: profile === 'analyst-eval',
      });
      await audit.insert({
        targetType: 'article',
        targetId: article.id,
        taskName: 'article_digest',
        model,
        promptVersion: ARTICLE_DIGEST_PROMPT_VERSION,
        requestJson: { articleId: article.id, inventorySize: inventory.length },
        responseJson: digest,
        validationStatus: 'valid',
      });
      digested += 1;
    } catch (error) {
      await articles.updateProcessingStatus(article.id, 'ENTITY_EXTRACTED');
      await audit.insert({
        targetType: 'article',
        targetId: article.id,
        taskName: 'article_digest',
        model,
        promptVersion: ARTICLE_DIGEST_PROMPT_VERSION,
        requestJson: { articleId: article.id, inventorySize: inventory.length },
        validationStatus: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      failed += 1;
    }
  });

  return { reviewed: candidates.length, digested, skipped, failed };
}
