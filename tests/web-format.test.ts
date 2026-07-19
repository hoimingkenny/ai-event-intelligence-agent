import { describe, expect, it } from 'vitest';
import { excerpt, formatConfidence, formatWhen } from '../web/lib/format.ts';

describe('web format helpers', () => {
  it('formats timestamps in HKT for the catalogue', () => {
    // 12:30 UTC → 20:30 HKT same calendar day
    expect(formatWhen(new Date('2026-07-13T12:30:00Z'))).toBe('13 Jul 2026, 20:30 HKT');
    expect(formatWhen(null)).toBe('—');
  });

  it('formats confidence as a percentage', () => {
    expect(formatConfidence(0.82)).toBe('82%');
    expect(formatConfidence(null)).toBe('—');
  });

  it('excerpts long article bodies for the public detail page', () => {
    expect(excerpt('  short  ')).toBe('short');
    expect(excerpt('x'.repeat(10), 8)).toBe('xxxxxxxx…');
    expect(excerpt(null)).toBeNull();
  });
});
