import { DigestGoldRepository } from '../db/repositories/digest-gold.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import {
  DIGEST_GOLD_TARGET_COUNT,
  type DigestGoldLabelRecord,
} from '../evaluation/digest/digest-gold-types.js';
import type {
  DigestGoldLabeledArticle,
  DigestGoldQueueArticle,
} from '../db/repositories/digest-gold.repository.js';

export interface DigestEvalQueueSnapshot {
  labeledCount: number;
  targetCount: number;
  candidates: DigestGoldQueueArticle[];
  labeled: DigestGoldLabeledArticle[];
}

export async function getDigestEvalQueue(
  db: Queryable,
  options: { listLimit?: number } = {}
): Promise<DigestEvalQueueSnapshot> {
  const repo = new DigestGoldRepository(db);
  const listLimit = options.listLimit ?? 50;
  const [labeledCount, candidates, labeled] = await Promise.all([
    repo.countLabels(),
    repo.listCandidates({ limit: listLimit }),
    repo.listLabeled({ limit: listLimit }),
  ]);

  return {
    labeledCount,
    targetCount: DIGEST_GOLD_TARGET_COUNT,
    candidates,
    labeled,
  };
}

export async function getDigestGoldForArticle(
  db: Queryable,
  articleId: string
): Promise<DigestGoldLabelRecord | null> {
  return new DigestGoldRepository(db).findByArticleId(articleId);
}
