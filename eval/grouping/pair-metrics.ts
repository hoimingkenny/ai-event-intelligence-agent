/**
 * Pure grouping-pair evaluator: distance bands + threshold tuner metrics.
 * No I/O — callers supply scored pairs (distance already resolved or null).
 */

import {
  EMBEDDING_ATTACH_DISTANCE,
  EMBEDDING_UNCERTAIN_DISTANCE,
} from '../../src/events/grouping-decision.js';
import type { GroupingPairLabel } from './pair-dataset.js';

export type DistanceBand = 'attach' | 'uncertain' | 'separate';

export interface GroupingPairThresholds {
  attach: number;
  uncertain: number;
}

export interface ScoredGroupingPair {
  urlA: string;
  urlB: string;
  label: GroupingPairLabel;
  humanReason: string;
  distance: number | null;
  goldIncidentId?: string | null;
  titleA?: string;
  titleB?: string;
  sourceNameA?: string;
  sourceNameB?: string;
}

export interface GroupingPairEvaluationReport {
  counts: {
    labeled: number;
    scorable: number;
    unscorable: number;
    fitSame: number;
    fitDifferent: number;
    uncertainLabels: number;
  };
  metrics: {
    falseAttachCount: number;
    sameEventMissAttachCount: number;
    uncertainBandCount: number;
  };
  sameDistances: number[];
  differentDistances: number[];
  candidateThresholds: GroupingPairThresholds;
  productionThresholds: GroupingPairThresholds;
  suggested: GroupingPairThresholds;
}

export function classifyDistanceBand(
  distance: number,
  attach: number = EMBEDDING_ATTACH_DISTANCE,
  uncertain: number = EMBEDDING_UNCERTAIN_DISTANCE
): DistanceBand {
  if (distance <= attach) return 'attach';
  if (distance <= uncertain) return 'uncertain';
  return 'separate';
}

/**
 * Suggested thresholds from labeled clouds:
 * - attach ≈ max(same distances) when a different-event floor exists above it
 * - uncertain ≈ min(different distances)
 * Falls back to production constants when a cloud is empty; enforces attach < uncertain.
 */
export function suggestThresholds(
  sameDistances: number[],
  differentDistances: number[]
): GroupingPairThresholds {
  let attach =
    sameDistances.length > 0 ? Math.max(...sameDistances) : EMBEDDING_ATTACH_DISTANCE;
  let uncertain =
    differentDistances.length > 0
      ? Math.min(...differentDistances)
      : EMBEDDING_UNCERTAIN_DISTANCE;

  if (attach >= uncertain) {
    const mid = (attach + uncertain) / 2;
    attach = Math.max(0, mid - 0.01);
    uncertain = mid + 0.01;
  }

  return {
    attach: round3(attach),
    uncertain: round3(uncertain),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function evaluateGroupingPairDataset(
  pairs: ScoredGroupingPair[],
  thresholds: GroupingPairThresholds
): GroupingPairEvaluationReport {
  const sameDistances: number[] = [];
  const differentDistances: number[] = [];
  let unscorable = 0;
  let uncertainLabels = 0;
  let falseAttachCount = 0;
  let sameEventMissAttachCount = 0;
  let uncertainBandCount = 0;

  for (const pair of pairs) {
    if (pair.distance == null || !Number.isFinite(pair.distance)) {
      unscorable += 1;
      continue;
    }

    if (pair.label === 'uncertain') {
      uncertainLabels += 1;
      continue;
    }

    const band = classifyDistanceBand(pair.distance, thresholds.attach, thresholds.uncertain);
    if (band === 'uncertain') uncertainBandCount += 1;

    if (pair.label === 'same_event') {
      sameDistances.push(pair.distance);
      if (band !== 'attach') sameEventMissAttachCount += 1;
    } else {
      differentDistances.push(pair.distance);
      if (band === 'attach') falseAttachCount += 1;
    }
  }

  sameDistances.sort((a, b) => a - b);
  differentDistances.sort((a, b) => a - b);

  return {
    counts: {
      labeled: pairs.length,
      scorable: pairs.length - unscorable,
      unscorable,
      fitSame: sameDistances.length,
      fitDifferent: differentDistances.length,
      uncertainLabels,
    },
    metrics: {
      falseAttachCount,
      sameEventMissAttachCount,
      uncertainBandCount,
    },
    sameDistances,
    differentDistances,
    candidateThresholds: thresholds,
    productionThresholds: {
      attach: EMBEDDING_ATTACH_DISTANCE,
      uncertain: EMBEDDING_UNCERTAIN_DISTANCE,
    },
    suggested: suggestThresholds(sameDistances, differentDistances),
  };
}
