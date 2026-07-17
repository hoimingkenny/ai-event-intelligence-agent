import { describe, expect, it } from 'vitest';
import {
  exactFieldAgreement,
  runDigestAgreementReport,
} from '../src/evaluation/digest/digest-agreement.js';

describe('exactFieldAgreement', () => {
  it('scores related and inventory fields when gold is related', () => {
    const exact = exactFieldAgreement(
      {
        relatedToMonitoredInventory: true,
        matchedVendors: ['CyberArk'],
        matchedProducts: ['PAS'],
        cves: ['CVE-2024-10001'],
        humanReason: null,
      },
      {
        relatedToMonitoredInventory: true,
        matchedVendors: ['cyberark'],
        matchedProducts: ['PAS'],
        cves: ['CVE-2024-10001'],
      }
    );
    expect(exact).toEqual({
      related: true,
      vendors: true,
      products: true,
      cves: true,
    });
  });

  it('nulls vendor/product when gold is unrelated', () => {
    const exact = exactFieldAgreement(
      {
        relatedToMonitoredInventory: false,
        matchedVendors: [],
        matchedProducts: [],
        cves: [],
        humanReason: null,
      },
      {
        relatedToMonitoredInventory: false,
        matchedVendors: [],
        matchedProducts: [],
        cves: [],
      }
    );
    expect(exact.vendors).toBeNull();
    expect(exact.products).toBeNull();
    expect(exact.related).toBe(true);
  });
});

describe('runDigestAgreementReport', () => {
  it('aggregates injectable judgements without writing gold', async () => {
    const report = await runDigestAgreementReport(
      [
        {
          articleId: '1',
          title: 'A',
          gold: {
            relatedToMonitoredInventory: true,
            matchedVendors: ['CyberArk'],
            matchedProducts: ['PAS'],
            cves: ['CVE-2024-1'],
            humanReason: null,
          },
          prediction: {
            relatedToMonitoredInventory: true,
            matchedVendors: ['CyberArk'],
            matchedProducts: ['ZIA'],
            cves: ['CVE-2024-1'],
          },
        },
      ],
      {
        runId: 'run-1',
        call: async () => ({
          relatedAgree: true,
          vendorsAgree: true,
          productsAgree: false,
          cvesAgree: true,
          reason: 'Products diverge.',
        }),
      }
    );

    expect(report.sampleCount).toBe(1);
    expect(report.relatedAgreeRate).toBe(1);
    expect(report.productAgreeRate).toBe(0);
    expect(report.samples[0].judgement.reason).toBe('Products diverge.');
  });
});
