import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEvaluation } from '../src/evaluation/run-evaluation.js';

describe('runEvaluation', () => {
  it('runs evaluation without database persistence by default', async () => {
    const result = await runEvaluation(null, {
      datasetPath: join(process.cwd(), 'data/labelled-eval-set.json'),
      runName: 'test-run',
    });

    expect(result.runId).toBeUndefined();
    expect(result.runName).toBe('test-run');
    expect(result.itemCount).toBeGreaterThan(0);
    expect(result.metrics.extraction_success_rate).toBeGreaterThan(0);
  });
});
