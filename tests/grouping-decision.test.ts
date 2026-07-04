import { describe, expect, it } from 'vitest';
import type { EventRecord } from '../src/db/repositories/event.repository.js';
import {
  applyComparison,
  decideEventGrouping,
  EMBEDDING_ATTACH_DISTANCE,
  EMBEDDING_UNCERTAIN_DISTANCE,
} from '../src/events/grouping-decision.js';
import { rollUpEventAssessment } from '../src/events/event-assessment.js';
import type { CyberClassification } from '../src/llm/schemas.js';

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: '1',
    groupingKey: 'cve:cve-2026-1234',
    eventTitle: 'Test event',
    eventSummary: null,
    eventStatus: 'open',
    severity: 'medium',
    urgency: 'P3',
    confidence: 0.6,
    affectedVendors: ['Microsoft'],
    affectedProducts: [],
    cves: ['CVE-2026-1234'],
    attackTypes: [],
    ...overrides,
  };
}

describe('decideEventGrouping ladder', () => {
  it('rung 1: attaches on exact grouping-key match without embeddings', () => {
    const decision = decideEventGrouping({
      groupingKey: 'cve:cve-2026-1234',
      keyMatch: event(),
      similarEvents: [],
    });

    expect(decision).toMatchObject({ kind: 'attach', method: 'grouping_key', confidence: 0.9 });
  });

  it('never key-matches the "unknown" grouping key', () => {
    const decision = decideEventGrouping({
      groupingKey: 'unknown',
      keyMatch: event({ groupingKey: 'unknown' }),
      similarEvents: [],
    });

    expect(decision.kind).toBe('create');
  });

  it('rung 2: attaches when embedding distance is within the attach threshold', () => {
    const decision = decideEventGrouping({
      groupingKey: 'unknown',
      keyMatch: null,
      similarEvents: [{ ...event(), distance: EMBEDDING_ATTACH_DISTANCE - 0.01 }],
    });

    expect(decision).toMatchObject({ kind: 'attach', method: 'embedding' });
  });

  it('rung 2: defers to the LLM in the uncertain band', () => {
    const decision = decideEventGrouping({
      groupingKey: 'unknown',
      keyMatch: null,
      similarEvents: [{ ...event(), distance: (EMBEDDING_ATTACH_DISTANCE + EMBEDDING_UNCERTAIN_DISTANCE) / 2 }],
    });

    expect(decision.kind).toBe('uncertain');
  });

  it('creates a new event beyond the uncertain threshold', () => {
    const decision = decideEventGrouping({
      groupingKey: 'unknown',
      keyMatch: null,
      similarEvents: [{ ...event(), distance: EMBEDDING_UNCERTAIN_DISTANCE + 0.01 }],
    });

    expect(decision).toMatchObject({ kind: 'create', method: 'no_match' });
  });

  it('creates a new event when there are no similar events at all', () => {
    const decision = decideEventGrouping({ groupingKey: 'unknown', keyMatch: null, similarEvents: [] });
    expect(decision.kind).toBe('create');
  });
});

describe('applyComparison (rung 3)', () => {
  const candidate = { ...event(), distance: 0.25 };

  it('attaches as material update when the LLM says so', () => {
    const decision = applyComparison(candidate, {
      relationship: 'same_event',
      confidence: 0.85,
      isMaterialUpdate: true,
      rationale: 'same CVE, new patch information',
    });

    expect(decision).toMatchObject({
      kind: 'attach',
      relationship: 'same_event_material_update',
      isMaterialUpdate: true,
      confidence: 0.85,
      method: 'llm_comparator',
    });
  });

  it('creates a new event for related-but-different and unrelated verdicts', () => {
    for (const relationship of ['related_but_different_event', 'unrelated'] as const) {
      const decision = applyComparison(candidate, {
        relationship,
        confidence: 0.7,
        isMaterialUpdate: false,
        rationale: 'different vendor',
      });
      expect(decision).toMatchObject({ kind: 'create', method: 'llm_comparator' });
    }
  });
});

describe('rollUpEventAssessment', () => {
  const classification: CyberClassification = {
    cyberRelevant: true,
    eventType: 'vulnerability_exploitation',
    severity: 'critical',
    urgency: 'P1',
    confidence: 0.9,
    vendorRoles: [{ vendor: 'Microsoft', role: 'affected', rationale: 'product is exploited' }],
    affectedProducts: ['Defender'],
    cves: ['CVE-2026-1234'],
    reasoning: 'active exploitation confirmed by CISA',
  };

  it('upgrades severity/urgency and raises confidence with LLM verdict', () => {
    const assessment = rollUpEventAssessment(event(), classification, 1);

    expect(assessment.severity).toBe('critical');
    expect(assessment.urgency).toBe('P1');
    expect(assessment.confidence).toBeCloseTo(0.35 + 0.4 * 0.9, 5);
  });

  it('never downgrades severity and adds corroboration bonus per extra source', () => {
    const existing = event({ severity: 'critical', urgency: 'P1', confidence: 0.5 });
    const milder = { ...classification, severity: 'low' as const, urgency: 'P4' as const, confidence: 0.6 };
    const assessment = rollUpEventAssessment(existing, milder, 3);

    expect(assessment.severity).toBe('critical');
    expect(assessment.urgency).toBe('P1');
    // 0.35 + 0.24 + 0.2 corroboration
    expect(assessment.confidence).toBeCloseTo(0.79, 5);
  });

  it('caps confidence at 0.2 when the LLM says not cyber relevant', () => {
    const assessment = rollUpEventAssessment(
      event({ confidence: 0.8 }),
      { ...classification, cyberRelevant: false },
      2
    );

    expect(assessment.confidence).toBe(0.2);
  });

  it('caps confidence at 0.95 and never lowers an established confidence', () => {
    const high = rollUpEventAssessment(event({ confidence: 0.93 }), classification, 5);
    expect(high.confidence).toBeLessThanOrEqual(0.95);
    expect(high.confidence).toBeGreaterThanOrEqual(0.93);
  });
});
