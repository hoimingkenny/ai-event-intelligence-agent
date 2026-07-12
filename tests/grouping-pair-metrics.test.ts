import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_ATTACH_DISTANCE,
  EMBEDDING_UNCERTAIN_DISTANCE,
} from '../src/events/grouping-decision.js';
import {
  classifyDistanceBand,
  evaluateGroupingPairDataset,
  type ScoredGroupingPair,
} from '../eval/grouping/pair-metrics.js';

function pair(
  label: ScoredGroupingPair['label'],
  distance: number | null,
  id = 'p'
): ScoredGroupingPair {
  return {
    urlA: `https://example.test/${id}-a`,
    urlB: `https://example.test/${id}-b`,
    label,
    humanReason: 'test',
    distance,
  };
}

describe('classifyDistanceBand', () => {
  it('matches production attach / uncertain / separate bands', () => {
    expect(classifyDistanceBand(0.1, 0.15, 0.35)).toBe('attach');
    expect(classifyDistanceBand(0.15, 0.15, 0.35)).toBe('attach');
    expect(classifyDistanceBand(0.2, 0.15, 0.35)).toBe('uncertain');
    expect(classifyDistanceBand(0.35, 0.15, 0.35)).toBe('uncertain');
    expect(classifyDistanceBand(0.4, 0.15, 0.35)).toBe('separate');
  });

  it('defaults to production constants when thresholds omitted', () => {
    expect(classifyDistanceBand(EMBEDDING_ATTACH_DISTANCE)).toBe('attach');
    expect(classifyDistanceBand(EMBEDDING_UNCERTAIN_DISTANCE)).toBe('uncertain');
  });
});

describe('evaluateGroupingPairDataset', () => {
  it('counts false attaches, same-event misses, and skips uncertain + unscorable', () => {
    const report = evaluateGroupingPairDataset(
      [
        pair('same_event', 0.1, 's1'), // attach ok
        pair('same_event', 0.2, 's2'), // miss attach (uncertain band)
        pair('different_event', 0.12, 'd1'), // false attach
        pair('different_event', 0.5, 'd2'), // separate ok
        pair('uncertain', 0.05, 'u1'), // excluded from fit
        pair('same_event', null, 'ns'), // unscorable
      ],
      { attach: 0.15, uncertain: 0.35 }
    );

    expect(report.counts.labeled).toBe(6);
    expect(report.counts.scorable).toBe(5);
    expect(report.counts.unscorable).toBe(1);
    expect(report.counts.fitSame).toBe(2);
    expect(report.counts.fitDifferent).toBe(2);
    expect(report.counts.uncertainLabels).toBe(1);
    expect(report.metrics.falseAttachCount).toBe(1);
    expect(report.metrics.sameEventMissAttachCount).toBe(1);
    expect(report.metrics.uncertainBandCount).toBe(1); // s2 only among fit pairs

    expect(report.sameDistances).toEqual([0.1, 0.2]);
    expect(report.differentDistances).toEqual([0.12, 0.5]);
    expect(report.productionThresholds).toEqual({
      attach: EMBEDDING_ATTACH_DISTANCE,
      uncertain: EMBEDDING_UNCERTAIN_DISTANCE,
    });
  });

  it('suggests attach below uncertain from same/different clouds', () => {
    const report = evaluateGroupingPairDataset(
      [
        pair('same_event', 0.05, '1'),
        pair('same_event', 0.1, '2'),
        pair('same_event', 0.12, '3'),
        pair('different_event', 0.4, '4'),
        pair('different_event', 0.5, '5'),
        pair('different_event', 0.55, '6'),
      ],
      { attach: 0.15, uncertain: 0.35 }
    );

    expect(report.suggested.attach).toBeLessThan(report.suggested.uncertain);
    expect(report.suggested.attach).toBeGreaterThanOrEqual(0.12);
    expect(report.suggested.uncertain).toBeLessThanOrEqual(0.4);
  });
});
