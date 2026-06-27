import { describe, expect, it } from 'vitest';
import { normalizeTitle, normalizeUrl } from '../src/extraction/url-normalizer.js';
import { hashNormalizedValue, sha256Hex } from '../src/utils/hash.js';

describe('normalizeUrl', () => {
  it('removes fragments, tracking parameters, and trailing slashes', () => {
    expect(
      normalizeUrl(
        'HTTPS://Example.COM/news/story/?utm_source=rss&utm_medium=email&keep=1&fbclid=abc#section'
      )
    ).toBe('https://example.com/news/story?keep=1');
  });

  it('sorts query parameters deterministically', () => {
    expect(normalizeUrl('https://example.com/a?b=2&a=1')).toBe('https://example.com/a?a=1&b=2');
  });

  it('keeps the root path slash', () => {
    expect(normalizeUrl('https://example.com/?utm_campaign=x')).toBe('https://example.com/');
  });
});

describe('normalizeTitle', () => {
  it('normalizes case, quote variants, and whitespace', () => {
    expect(normalizeTitle('  “Critical”   Patch Released  ')).toBe('"critical" patch released');
  });
});

describe('hash helpers', () => {
  it('hashes values deterministically', () => {
    expect(hashNormalizedValue(' same value ')).toBe(hashNormalizedValue('same value'));
    expect(sha256Hex('same value')).toHaveLength(64);
  });
});
