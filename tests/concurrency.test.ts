import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from '../src/utils/concurrency.js';

describe('runWithConcurrency', () => {
  it('caps in-flight workers to the requested concurrency', async () => {
    const items = [1, 2, 3, 4, 5];
    let inFlight = 0;
    let maxInFlight = 0;
    const seen: number[] = [];

    await runWithConcurrency(items, 2, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      seen.push(item);
      inFlight -= 1;
    });

    expect(maxInFlight).toBe(2);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('no-ops on an empty list', async () => {
    let calls = 0;
    await runWithConcurrency([], 5, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});
