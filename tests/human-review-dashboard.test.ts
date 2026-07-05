import { describe, expect, it } from 'vitest';
import {
  HumanReviewSubmissionSchema,
  needsHumanAttention,
  prioritizeCases,
  renderHumanReviewDashboard,
  saveHumanReviewVerdict,
  summarizeCases,
  type HumanReviewCase,
  type HumanReviewDashboard,
} from '../src/review/human-review-dashboard.js';
import type { Queryable } from '../src/db/repositories/types.js';

const baseCase: HumanReviewCase = {
  article: {
    id: '1',
    title: 'Cisco patches exploited firewall flaw',
    canonicalUrl: 'https://example.test/cisco-firewall',
    sourceName: 'Example Security',
    publishedAt: new Date('2026-07-05T01:00:00Z'),
    fetchedAt: new Date('2026-07-05T01:05:00Z'),
    processingStatus: 'CLASSIFIED',
    extractionStatus: 'success',
    extractionMethod: 'http_readability',
    extractionError: null,
    contentQualityScore: 0.92,
    rssRecall: 0.88,
    rssSummary: 'Cisco patched an exploited firewall flaw.',
    cleanText: 'Cisco patched an exploited firewall flaw affecting monitored products.',
    llmClassification: {
      isCyberEvent: true,
      affectedVendors: ['Cisco'],
      severity: 'high',
    },
  },
  entities: [
    {
      articleId: '1',
      entityType: 'vendor',
      entityValue: 'Cisco',
      confidence: 0.9,
      role: 'affected',
    },
  ],
  events: [
    {
      articleId: '1',
      eventId: '10',
      eventTitle: 'Cisco firewall exploited vulnerability',
      eventSummary: 'A firewall vulnerability is being exploited.',
      groupingKey: 'cve:CVE-2026-0001',
      relationship: 'same_event_new_source',
      relationshipConfidence: 0.84,
      isPrimarySource: true,
      isMaterialUpdate: false,
      severity: 'high',
      urgency: 'P2',
      eventConfidence: 0.82,
      affectedVendors: ['Cisco'],
      affectedProducts: ['Firewall'],
      cves: ['CVE-2026-0001'],
      attackTypes: ['exploitation'],
    },
  ],
  alerts: [
    {
      eventId: '10',
      alertStatus: 'sent',
      alertTier: 'confirmed',
      alertReason: 'confirmed_vendor_impact_event',
      suppressed: false,
      suppressionReason: null,
      sentAt: new Date('2026-07-05T01:06:00Z'),
      createdAt: new Date('2026-07-05T01:06:00Z'),
    },
  ],
  verdict: null,
  audits: [
    {
      targetType: 'article',
      targetId: '1',
      taskName: 'classify_article',
      validationStatus: 'valid',
      createdAt: new Date('2026-07-05T01:06:00Z'),
    },
  ],
};

describe('human review dashboard', () => {
  it('summarizes alert and review counts for a human queue', () => {
    const earlyWarningCase: HumanReviewCase = {
      ...baseCase,
      article: { ...baseCase.article, id: '2' },
      alerts: [
        {
          ...baseCase.alerts[0],
          alertTier: 'early_warning',
          alertReason: 'early_warning_unconfirmed_signal',
        },
      ],
    };
    const failedExtractionCase: HumanReviewCase = {
      ...baseCase,
      article: {
        ...baseCase.article,
        id: '3',
        extractionStatus: 'failed',
        extractionError: 'http_failed',
      },
      events: [],
      alerts: [],
      audits: [],
    };

    const summary = summarizeCases([baseCase, earlyWarningCase, failedExtractionCase]);

    expect(summary).toMatchObject({
      totalArticles: 3,
      needsAttention: 2,
      earlyWarnings: 1,
      confirmedAlerts: 1,
      extractionFailures: 1,
    });
  });

  it('flags uncertain, low-confidence, and early-warning cases for review', () => {
    expect(needsHumanAttention(baseCase)).toBe(false);
    expect(
      needsHumanAttention({
        ...baseCase,
        events: [
          {
            ...baseCase.events[0],
            relationship: 'uncertain_need_human_review',
          },
        ],
      })
    ).toBe(true);
    expect(
      needsHumanAttention({
        ...baseCase,
        events: [
          {
            ...baseCase.events[0],
            eventConfidence: 0.5,
          },
        ],
      })
    ).toBe(true);
    expect(
      needsHumanAttention({
        ...baseCase,
        alerts: [
          {
            ...baseCase.alerts[0],
            alertTier: 'early_warning',
          },
        ],
      })
    ).toBe(true);
  });

  it('treats a saved human verdict as reviewed', () => {
    expect(
      needsHumanAttention({
        ...baseCase,
        alerts: [
          {
            ...baseCase.alerts[0],
            alertTier: 'early_warning',
          },
        ],
        verdict: {
          articleId: '1',
          eventId: '10',
          relevanceVerdict: 'correct',
          vendorImpactVerdict: 'correct',
          llmClassificationVerdict: 'correct',
          groupingVerdict: 'correct',
          alertVerdict: 'unclear',
          notes: 'Need a second source before confirmed escalation.',
          reviewer: 'analyst',
          reviewedAt: new Date('2026-07-05T01:10:00Z'),
        },
      })
    ).toBe(false);
  });

  it('validates human review submissions before persistence', () => {
    expect(
      HumanReviewSubmissionSchema.parse({
        articleId: '123',
        eventId: '456',
        relevanceVerdict: 'correct',
        vendorImpactVerdict: 'incorrect',
        llmClassificationVerdict: 'correct',
        groupingVerdict: 'unclear',
        alertVerdict: 'not_reviewed',
        notes: 'Vendor was mentioned but not affected.',
        reviewer: 'kenny',
      })
    ).toMatchObject({
      articleId: '123',
      relevanceVerdict: 'correct',
    });

    expect(() =>
      HumanReviewSubmissionSchema.parse({
        articleId: 'abc',
        relevanceVerdict: 'yes',
        vendorImpactVerdict: 'correct',
        groupingVerdict: 'correct',
        alertVerdict: 'correct',
      })
    ).toThrow();
  });

  it('rejects verdicts for events that are not linked to the article', async () => {
    const fakeDb = {
      query: async () => ({ rows: [{ exists: false }] }),
    } as unknown as Queryable;

    await expect(
      saveHumanReviewVerdict(fakeDb, {
        articleId: '123',
        eventId: '456',
        relevanceVerdict: 'correct',
        vendorImpactVerdict: 'correct',
        llmClassificationVerdict: 'correct',
        groupingVerdict: 'correct',
        alertVerdict: 'correct',
      })
    ).rejects.toThrow('Selected event is not linked to this article.');
  });

  it('renders escaped article data and review prompts', () => {
    const dashboard: HumanReviewDashboard = {
      generatedAt: new Date('2026-07-05T02:00:00Z'),
      cases: [
        {
          ...baseCase,
          article: {
            ...baseCase.article,
            title: '<script>alert("bad")</script> Cisco update',
          },
        },
      ],
      summary: summarizeCases([baseCase]),
    };

    const html = renderHumanReviewDashboard(dashboard);

    expect(html).toContain('Human Review Dashboard');
    expect(html).toContain('&lt;script&gt;alert(&quot;bad&quot;)&lt;/script&gt; Cisco update');
    expect(html).not.toContain('<script>alert("bad")</script>');
    expect(html).toContain('Vendor impact correct');
    expect(html).toContain('LLM Classification');
    expect(html).toContain('&quot;isCyberEvent&quot;: true');
    expect(html).toContain('Cisco firewall exploited vulnerability');
  });
});

describe('prioritizeCases', () => {
  const reviewed = {
    articleId: '1',
    eventId: null,
    relevanceVerdict: 'correct',
    vendorImpactVerdict: 'correct',
    llmClassificationVerdict: 'correct',
    groupingVerdict: 'correct',
    alertVerdict: 'correct',
    notes: null,
    reviewer: 'kenny',
    reviewedAt: new Date('2026-07-05T02:00:00Z'),
  } as HumanReviewCase['verdict'];

  it('orders attention cases first, then unreviewed, preserving recency within groups', () => {
    const calm: HumanReviewCase = structuredClone(baseCase);
    const calmReviewed: HumanReviewCase = { ...structuredClone(baseCase), verdict: reviewed };
    const attention: HumanReviewCase = structuredClone(baseCase);
    attention.alerts[0] = { ...attention.alerts[0], alertTier: 'early_warning' };

    const ordered = prioritizeCases([calmReviewed, calm, attention]);

    expect(ordered[0]).toBe(attention);
    expect(ordered[1]).toBe(calm); // unreviewed before reviewed
    expect(ordered[2]).toBe(calmReviewed);
  });

  it('is stable for cases with equal priority', () => {
    const first = structuredClone(baseCase);
    const second = structuredClone(baseCase);
    const ordered = prioritizeCases([first, second]);
    expect(ordered[0]).toBe(first);
    expect(ordered[1]).toBe(second);
  });
});
