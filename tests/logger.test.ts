import { describe, expect, it } from 'vitest';
import { redactLogObject } from '../src/utils/logger.js';
import { MetricsCollector, recordStageResult } from '../src/utils/metrics.js';

describe('logger redaction', () => {
  it('redacts nested sensitive keys', () => {
    expect(
      redactLogObject({
        apiKey: 'secret',
        nested: {
          accessToken: 'token',
          safe: 'value',
        },
      })
    ).toEqual({
      apiKey: '[REDACTED]',
      nested: {
        accessToken: '[REDACTED]',
        safe: 'value',
      },
    });
  });
});

describe('recordStageResult', () => {
  it('records numeric stage fields as counters', () => {
    const metrics = new MetricsCollector();
    recordStageResult('dedup', { reviewed: 2, unique: 1, note: 'ok' }, metrics);

    expect(metrics.snapshot()).toEqual({
      dedup_reviewed_total: 2,
      dedup_unique_total: 1,
    });
  });
});
