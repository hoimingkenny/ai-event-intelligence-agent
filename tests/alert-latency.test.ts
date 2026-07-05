import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import { checkAlertLatency, percentile } from '../src/monitoring/alert-latency.js';

function stubDb(latencySeconds: number[]): Queryable {
  return {
    async query<T>() {
      return {
        rows: latencySeconds.map((value, index) => ({
          alert_id: String(index + 1),
          latency_seconds: value,
        })) as T[],
        rowCount: latencySeconds.length,
      };
    },
  } as Queryable;
}

const H = 3600;

describe('checkAlertLatency', () => {
  it('reports healthy latency within the SLO', async () => {
    const report = await checkAlertLatency(stubDb([0.5 * H, 1 * H, 1.2 * H, 0.8 * H]), {
      sloHours: 2,
    });

    expect(report.sloViolated).toBe(false);
    expect(report.p90Hours).toBeLessThanOrEqual(1.2);
    expect(report.breaches).toBe(0);
  });

  it('flags SLO violation when p90 exceeds the window', async () => {
    const report = await checkAlertLatency(stubDb([1 * H, 3 * H, 4 * H, 5 * H, 6 * H]), {
      sloHours: 2,
    });

    expect(report.sloViolated).toBe(true);
    expect(report.breaches).toBe(4);
  });

  it('does not judge below the minimum sample size', async () => {
    const report = await checkAlertLatency(stubDb([10 * H]), { sloHours: 2, minSample: 3 });
    expect(report.sloViolated).toBe(false);
    expect(report.sampled).toBe(1);
  });

  it('handles the empty case', async () => {
    const report = await checkAlertLatency(stubDb([]), { sloHours: 2 });
    expect(report.p50Hours).toBeNull();
    expect(report.sloViolated).toBe(false);
  });
});

describe('percentile', () => {
  it('computes p50/p90 on sorted input', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.5)).toBe(5);
    expect(percentile(values, 0.9)).toBe(9);
    expect(percentile([], 0.5)).toBeNull();
  });
});
