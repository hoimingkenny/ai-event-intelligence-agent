import { describe, expect, it } from 'vitest';
import { evaluateDigestEvalSamples, scoreDigestEvalSample } from '../eval/utils/digest-metrics.js';
import type { DigestEvalScoredSample } from '../eval/types/digest-eval.types.js';

function sample(
  articleId: string,
  gold: Partial<DigestEvalScoredSample['gold']>,
  prediction: Partial<DigestEvalScoredSample['prediction']>
): DigestEvalScoredSample {
  return {
    articleId,
    gold: {
      relatedToMonitoredInventory: false,
      matchedVendors: [],
      matchedProducts: [],
      cves: [],
      humanReason: null,
      ...gold,
    },
    prediction: {
      relatedToMonitoredInventory: false,
      matchedVendors: [],
      matchedProducts: [],
      cves: [],
      ...prediction,
    },
  };
}

describe('digest eval metrics', () => {
  it('scores relatedness F1 and inventory matches on related gold only', () => {
    const report = evaluateDigestEvalSamples([
      sample(
        '1',
        {
          relatedToMonitoredInventory: true,
          matchedVendors: ['CyberArk'],
          matchedProducts: ['PAS'],
          cves: ['CVE-2024-10001'],
        },
        {
          relatedToMonitoredInventory: true,
          matchedVendors: ['CyberArk'],
          matchedProducts: ['PAS'],
          cves: ['CVE-2024-10001'],
        }
      ),
      sample(
        '2',
        { relatedToMonitoredInventory: false, cves: [] },
        { relatedToMonitoredInventory: false, cves: [] }
      ),
      sample(
        '3',
        {
          relatedToMonitoredInventory: true,
          matchedProducts: ['ZIA'],
          cves: ['CVE-2024-20002'],
        },
        {
          relatedToMonitoredInventory: false,
          matchedProducts: [],
          cves: ['CVE-2024-20002'],
        }
      ),
    ]);

    expect(report.metrics.goldCount).toBe(3);
    expect(report.metrics.relatedGoldCount).toBe(2);
    expect(report.metrics.relatednessF1).toBeCloseTo(0.666, 2);
    expect(report.metrics.vendorExactMatchRate).toBe(1);
    expect(report.metrics.productExactMatchRate).toBe(0.5);
    expect(report.metrics.cveExactMatchRate).toBe(1);
    expect(report.results.filter((r) => r.failures.length > 0)).toHaveLength(1);
  });

  it('activates soft gates only when gold count reaches 40', () => {
    const small = evaluateDigestEvalSamples(
      Array.from({ length: 10 }, (_, index) =>
        sample(String(index), { relatedToMonitoredInventory: false }, { relatedToMonitoredInventory: false })
      )
    );
    expect(small.gate.active).toBe(false);
    expect(small.gate.warnings[0]).toMatch(/inactive until 40/i);

    const large = evaluateDigestEvalSamples(
      Array.from({ length: 40 }, (_, index) =>
        sample(
          String(index),
          { relatedToMonitoredInventory: true, matchedProducts: ['PAS'] },
          { relatedToMonitoredInventory: false, matchedProducts: [] }
        )
      )
    );
    expect(large.gate.active).toBe(true);
    expect(large.gate.warnings.length).toBeGreaterThan(0);
  });

  it('computes set-F1 diagnostics for partial vendor overlap', () => {
    const result = scoreDigestEvalSample(
      sample(
        '9',
        {
          relatedToMonitoredInventory: true,
          matchedVendors: ['CyberArk', 'Microsoft'],
          matchedProducts: ['PAS'],
          cves: ['CVE-2024-1', 'CVE-2024-2'],
        },
        {
          relatedToMonitoredInventory: true,
          matchedVendors: ['CyberArk'],
          matchedProducts: ['PAS'],
          cves: ['CVE-2024-1'],
        }
      )
    );

    expect(result.vendorExactMatch).toBe(false);
    expect(result.vendorSetF1).toBeCloseTo(0.666, 2);
    expect(result.productExactMatch).toBe(true);
    expect(result.cveSetF1).toBeCloseTo(0.666, 2);
  });
});
