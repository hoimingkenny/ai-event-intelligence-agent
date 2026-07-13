import { describe, expect, it } from 'vitest';
import { decideAlert } from '../src/alerts/alert-decision.js';
import type { EventRecord } from '../src/db/repositories/event.repository.js';

const NOW = new Date('2026-07-02T12:00:00Z');

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: '1',
    groupingKey: 'cyberark::exploitation',
    firstSeenAt: new Date('2026-07-02T11:00:00Z'), // 1h old = fresh
    eventTitle: 'CyberArk exploitation report',
    eventSummary: 'summary',
    eventStatus: 'open',
    publicationStatus: 'draft',
    severity: 'high',
    urgency: 'P2',
    confidence: 0.8,
    affectedVendors: ['CyberArk'],
    affectedProducts: [],
    cves: [],
    attackTypes: [],
    ...overrides,
  };
}

describe('decideAlert — confirmed tier', () => {
  it('sends a confirmed alert for confident P1/P2 vendor-impact events', () => {
    const decision = decideAlert(event(), { now: NOW });

    expect(decision).toMatchObject({
      shouldAlert: true,
      tier: 'confirmed',
      reason: 'confirmed_vendor_impact_event',
    });
  });

  it('suppresses events with no affected vendor', () => {
    const decision = decideAlert(event({ affectedVendors: [] }), { now: NOW });
    expect(decision).toMatchObject({ shouldAlert: false, reason: 'no_affected_vendor' });
  });
});

describe('decideAlert — early warning tier', () => {
  it('sends a labeled early warning for a fresh low-confidence signal', () => {
    // Below the confirmed gate on confidence AND urgency — old design suppressed this.
    const decision = decideAlert(event({ confidence: 0.4, urgency: 'P3', severity: 'low' }), {
      now: NOW,
    });

    expect(decision).toMatchObject({
      shouldAlert: true,
      tier: 'early_warning',
      reason: 'early_warning_unconfirmed_signal',
    });
  });

  it('treats unknown event age as fresh (fail toward signal, not silence)', () => {
    const decision = decideAlert(event({ firstSeenAt: null, confidence: 0.3, urgency: 'P4' }), {
      now: NOW,
    });
    expect(decision.tier).toBe('early_warning');
  });

  it('suppresses stale events that never crossed the confirmed gate', () => {
    const decision = decideAlert(
      event({ firstSeenAt: new Date('2026-06-25T00:00:00Z'), confidence: 0.4, urgency: 'P3' }),
      { now: NOW, earlyWindowHours: 24 }
    );

    expect(decision).toMatchObject({ shouldAlert: false, reason: 'stale_event_below_confirmed_gate' });
  });
});

describe('decideAlert — suppression window interactions', () => {
  const recentEarly = { tier: 'early_warning' as const, createdAt: new Date('2026-07-02T11:30:00Z') };
  const recentConfirmed = { tier: 'confirmed' as const, createdAt: new Date('2026-07-02T11:30:00Z') };

  it('suppresses a repeat alert with no new information', () => {
    const decision = decideAlert(event(), { now: NOW, recentAlert: recentConfirmed });
    expect(decision).toMatchObject({ shouldAlert: false, reason: 'recent_alert_suppression' });
  });

  it('upgrades an early warning to confirmed once the gate is crossed', () => {
    const decision = decideAlert(event({ confidence: 0.85 }), { now: NOW, recentAlert: recentEarly });

    expect(decision).toMatchObject({
      shouldAlert: true,
      tier: 'confirmed',
      reason: 'upgraded_to_confirmed',
    });
  });

  it('does not upgrade when still below the confirmed gate', () => {
    const decision = decideAlert(event({ confidence: 0.4 }), { now: NOW, recentAlert: recentEarly });
    expect(decision.shouldAlert).toBe(false);
  });

  it('material updates bypass suppression (guardrail)', () => {
    const decision = decideAlert(event(), {
      now: NOW,
      recentAlert: recentConfirmed,
      hasNewMaterialUpdate: true,
    });

    expect(decision).toMatchObject({
      shouldAlert: true,
      reason: 'material_update_bypasses_suppression',
      tier: 'confirmed',
    });
  });

  it('material update on a still-unconfirmed event re-alerts at early tier', () => {
    const decision = decideAlert(event({ confidence: 0.4 }), {
      now: NOW,
      recentAlert: recentEarly,
      hasNewMaterialUpdate: true,
    });

    expect(decision).toMatchObject({ shouldAlert: true, tier: 'early_warning' });
  });
});
