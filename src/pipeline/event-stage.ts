import { env } from '../config/env.js';
import { model } from '../config/llm.js';
import { ArticleRepository, type ArticleRecord } from '../db/repositories/article.repository.js';
import { EntityRepository } from '../db/repositories/entity.repository.js';
import { EventRepository, type EventRecord } from '../db/repositories/event.repository.js';
import { LlmAuditRepository } from '../db/repositories/llm-audit.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { buildEventDraft } from '../events/event-grouper.js';
import {
  applyComparison,
  decideEventGrouping,
  type GroupingDecision,
} from '../events/grouping-decision.js';
import { compareArticleToEvent } from '../llm/event-comparator.js';
import type { EventComparison } from '../llm/schemas.js';

export type EventComparator = (
  article: ArticleRecord,
  event: EventRecord
) => Promise<EventComparison>;

export interface EventStageResult {
  reviewed: number;
  created: number;
  attached: number;
  attachedByKey: number;
  attachedByEmbedding: number;
  attachedByLlm: number;
  llmCompared: number;
  duplicateSkipped: number;
}

export async function runEventStage(
  db: Queryable,
  options: { limit?: number; comparator?: EventComparator | null } = {}
): Promise<EventStageResult> {
  const articles = new ArticleRepository(db);
  const entities = new EntityRepository(db);
  const events = new EventRepository(db);
  const audit = new LlmAuditRepository(db);
  // Comparator only used in the uncertain embedding band; null disables rung 3.
  const comparator =
    options.comparator !== undefined
      ? options.comparator
      : env.minimaxApiKey
        ? compareArticleToEvent
        : null;

  const candidates = [
    ...(await articles.listByProcessingStatus('EMBEDDED', options.limit ?? 20)),
    ...(await articles.listByProcessingStatus('ENTITY_EXTRACTED', options.limit ?? 20)),
  ].slice(0, options.limit ?? 20);

  const result: EventStageResult = {
    reviewed: candidates.length,
    created: 0,
    attached: 0,
    attachedByKey: 0,
    attachedByEmbedding: 0,
    attachedByLlm: 0,
    llmCompared: 0,
    duplicateSkipped: 0,
  };

  for (const article of candidates) {
    if (article.processingStatus === 'DUPLICATE') {
      result.duplicateSkipped += 1;
      continue;
    }

    const articleEntities = await entities.listForArticle(article.id);
    const draft = buildEventDraft(article, articleEntities);

    // Rung 1 input: open event with the same canonical key.
    const keyMatch =
      draft.groupingKey !== 'unknown' ? await events.findOpenByGroupingKey(draft.groupingKey) : null;

    // Rung 2 input: nearest open events by embedding (skipped when unembedded).
    const vector = keyMatch ? null : await articles.getEmbedding(article.id);
    const similarEvents = vector ? await events.findSimilarEvents(vector, { limit: 3 }) : [];

    let decision: GroupingDecision = decideEventGrouping({
      groupingKey: draft.groupingKey,
      keyMatch,
      similarEvents,
    });

    // Rung 3: LLM comparator for the uncertain band.
    if (decision.kind === 'uncertain') {
      decision = comparator
        ? await resolveWithComparator(comparator, article, decision.candidate, audit, result)
        : { kind: 'create', method: 'no_match' };
    }

    if (decision.kind === 'attach') {
      await events.attachArticle({
        eventId: decision.event.id,
        articleId: article.id,
        relationship: decision.relationship,
        confidence: decision.confidence,
        isPrimarySource: false,
        isMaterialUpdate: decision.isMaterialUpdate,
      });
      result.attached += 1;
      if (decision.method === 'grouping_key') result.attachedByKey += 1;
      if (decision.method === 'embedding') result.attachedByEmbedding += 1;
      if (decision.method === 'llm_comparator') result.attachedByLlm += 1;
    } else {
      const event = await events.createEvent({
        eventTitle: draft.title,
        eventSummary: draft.summary,
        groupingKey: draft.groupingKey === 'unknown' ? null : draft.groupingKey,
        severity: draft.severity,
        urgency: draft.urgency,
        confidence: 0.6,
        affectedVendors: draft.affectedVendors,
        affectedProducts: draft.affectedProducts,
        cves: draft.cves,
        attackTypes: draft.attackTypes,
      });
      await events.attachArticle({
        eventId: event.id,
        articleId: article.id,
        relationship: 'same_event',
        confidence: 0.6,
        isPrimarySource: true,
      });
      result.created += 1;
      result.attached += 1;
    }

    await articles.updateProcessingStatus(article.id, 'GROUPED');
  }

  return result;
}

async function resolveWithComparator(
  comparator: EventComparator,
  article: ArticleRecord,
  candidate: EventRecord & { distance: number },
  audit: LlmAuditRepository,
  result: EventStageResult
): Promise<GroupingDecision> {
  result.llmCompared += 1;
  try {
    const comparison = await comparator(article, candidate);
    await audit.insert({
      targetType: 'article',
      targetId: article.id,
      taskName: 'event_comparison',
      model,
      promptVersion: 'event-comparator-v1',
      requestJson: { articleId: article.id, eventId: candidate.id, distance: candidate.distance },
      responseJson: comparison,
      validationStatus: 'valid',
    });
    return applyComparison(candidate, comparison);
  } catch (error) {
    await audit.insert({
      targetType: 'article',
      targetId: article.id,
      taskName: 'event_comparison',
      model,
      promptVersion: 'event-comparator-v1',
      requestJson: { articleId: article.id, eventId: candidate.id, distance: candidate.distance },
      validationStatus: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    // Fail open to a new event: a spurious split is recoverable (events can be
    // merged later); silently fusing two incidents is not.
    return { kind: 'create', method: 'no_match' };
  }
}
