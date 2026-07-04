import type { EventRecord } from '../db/repositories/event.repository.js';
import type { CyberClassification } from '../llm/schemas.js';

/**
 * Rolls an article's LLM classification up into its event's assessment.
 * Replaces the hardcoded confidence=0.6 that events were created with.
 *
 * Deterministic and explainable by design:
 * - severity/urgency: never downgrade — max of current event value and the
 *   classification (a second, milder article must not soften an event).
 * - confidence: base 0.35 + LLM confidence (weight 0.4) + corroboration bonus
 *   per additional independent source (0.1 each, capped at 3), ceiling 0.95.
 * - a not-cyber-relevant verdict caps confidence at 0.2 instead of raising it.
 */

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;
const URGENCY_RANK = { P4: 0, P3: 1, P2: 2, P1: 3 } as const;

export interface EventAssessment {
  severity: string;
  urgency: string;
  confidence: number;
}

export function rollUpEventAssessment(
  event: EventRecord,
  classification: CyberClassification,
  sourceCount: number
): EventAssessment {
  const severity = maxByRank(event.severity, classification.severity, SEVERITY_RANK, 'medium');
  const urgency = maxByRank(event.urgency, classification.urgency, URGENCY_RANK, 'P3');

  if (!classification.cyberRelevant) {
    return { severity, urgency, confidence: Math.min(event.confidence ?? 0.2, 0.2) };
  }

  const corroboration = 0.1 * Math.min(Math.max(sourceCount - 1, 0), 3);
  const confidence = Math.min(0.95, 0.35 + 0.4 * classification.confidence + corroboration);

  // Never lower confidence a previous classification already established.
  return { severity, urgency, confidence: Math.max(confidence, event.confidence ?? 0) };
}

function maxByRank<K extends string>(
  current: string | null | undefined,
  incoming: K,
  ranks: Record<string, number>,
  fallback: K
): string {
  const currentRank = current && current in ranks ? ranks[current] : -1;
  const incomingRank = incoming in ranks ? ranks[incoming] : ranks[fallback];
  return incomingRank > currentRank ? incoming : (current as string);
}
