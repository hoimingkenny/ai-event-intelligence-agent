import { describe, expect, it } from 'vitest';
import { cosineDistance } from '../eval/grouping/score-pairs.js';

describe('cosineDistance', () => {
  it('is 0 for identical vectors and 1 for orthogonal unit vectors', () => {
    expect(cosineDistance([1, 0], [1, 0])).toBeCloseTo(0);
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1);
  });
});
