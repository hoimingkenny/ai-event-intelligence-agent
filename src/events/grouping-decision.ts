import type { EventRecord } from '../db/repositories/event.repository.js';
import type { EventComparison } from '../llm/schemas.js';

/**
 * Event-grouping ladder — pure decision logic, no I/O.
 *
 * Rungs (cheapest first):
 *   1. Exact grouping-key match against an open event  → attach, no LLM.
 *   2. Event-embedding distance:
 *        <= ATTACH threshold                           → attach, no LLM.
 *        (ATTACH, UNCERTAIN]                           → ask the LLM comparator.
 *        >  UNCERTAIN                                  → new event, no LLM.
 *   3. LLM comparator verdict resolves the uncertain band only.
 *
 * The LLM therefore sees only genuinely ambiguous pairs, which bounds cost
 * and keeps grouping deterministic wherever determinism is possible.
 */

/** Cosine distance at or below which two embeddings are confidently the same event. */
export const EMBEDDING_ATTACH_DISTANCE = 0.15;
/** Cosine distance above which candidates are confidently different events. */
export const EMBEDDING_UNCERTAIN_DISTANCE = 0.35;

export type SimilarEvent = EventRecord & { distance: number };

export type GroupingDecision =
  | {
      kind: 'attach';
      event: EventRecord;
      relationship: string;
      confidence: number;
      isMaterialUpdate: boolean;
      method: 'grouping_key' | 'embedding' | 'llm_comparator';
    }
  | { kind: 'create'; method: 'no_match' | 'llm_comparator' }
  | { kind: 'uncertain'; candidate: SimilarEvent };

export function decideEventGrouping(input: {
  groupingKey: string;
  keyMatch: EventRecord | null;
  similarEvents: SimilarEvent[];
}): GroupingDecision {
  // Rung 1: canonical key. 'unknown' keys (no entities) never key-match.
  if (input.keyMatch && input.groupingKey !== 'unknown') {
    return {
      kind: 'attach',
      event: input.keyMatch,
      relationship: 'same_event_new_source',
      confidence: 0.9,
      isMaterialUpdate: false,
      method: 'grouping_key',
    };
  }

  // Rung 2: embedding distance bands.
  const best = input.similarEvents[0];
  if (best) {
    if (best.distance <= EMBEDDING_ATTACH_DISTANCE) {
      return {
        kind: 'attach',
        event: best,
        relationship: 'same_event_new_source',
        confidence: 0.75,
        isMaterialUpdate: false,
        method: 'embedding',
      };
    }
    if (best.distance <= EMBEDDING_UNCERTAIN_DISTANCE) {
      return { kind: 'uncertain', candidate: best };
    }
  }

  return { kind: 'create', method: 'no_match' };
}

/** Rung 3: map the LLM comparator verdict for an uncertain candidate. */
export function applyComparison(
  candidate: SimilarEvent,
  comparison: EventComparison
): GroupingDecision {
  if (comparison.relationship === 'same_event') {
    return {
      kind: 'attach',
      event: candidate,
      relationship: comparison.isMaterialUpdate
        ? 'same_event_material_update'
        : 'same_event_new_source',
      confidence: comparison.confidence,
      isMaterialUpdate: comparison.isMaterialUpdate,
      method: 'llm_comparator',
    };
  }

  // related_but_different_event and unrelated both mean a new event; the
  // distinction is preserved in the LLM audit log.
  return { kind: 'create', method: 'llm_comparator' };
}
