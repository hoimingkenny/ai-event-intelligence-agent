import { describe, expect, it } from 'vitest';
import { decideAlert } from '../src/alerts/alert-decision.js';

describe('decideAlert', () => {
  it('alerts for confident P1/P2 vendor-impact events', () => {
    const decision = decideAlert({
      id: '1',
      eventTitle: 'CVE report',
      eventSummary: 'summary',
      eventStatus: 'open',
      severity: 'high',
      urgency: 'P2',
      confidence: 0.8,
      affectedVendors: ['SailPoint'],
    });

    expect(decision.shouldAlert).toBe(true);
    expect(decision.reason).toBe('new_vendor_impact_event');
  });

  it('suppresses recent duplicate alerts', () => {
    const decision = decideAlert(
      {
        id: '1',
        eventTitle: 'CVE report',
        eventSummary: 'summary',
        eventStatus: 'open',
        severity: 'high',
        urgency: 'P2',
        confidence: 0.8,
        affectedVendors: ['SailPoint'],
      },
      { hasRecentAlert: true }
    );

    expect(decision.shouldAlert).toBe(false);
    expect(decision.reason).toBe('recent_alert_suppression');
  });
});
