import { describe, expect, it } from 'vitest';
import {
  canonicalPairKey,
  deriveGroupingPairsFromGoldIncidents,
} from '../eval/grouping/pair-dataset.js';
import type { GoldIncident } from '../eval/grouping/gold-incidents.js';

function article(id: string, path: string) {
  return {
    articleId: id,
    url: `https://example.test/${path}`,
    title: path,
    sourceName: 'Test',
  };
}

function incident(id: string, name: string, paths: string[]): GoldIncident {
  return {
    id,
    name,
    articles: paths.map((p, i) => article(`${id}-${i}`, p)),
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  };
}

describe('deriveGroupingPairsFromGoldIncidents', () => {
  it('derives same_event within baskets and different_event across baskets', () => {
    const sailpoint = incident('sp', 'SailPoint', ['a', 'b', 'c']);
    const sharepoint = incident('sh', 'SharePoint', ['d', 'e', 'f']);

    const pairs = deriveGroupingPairsFromGoldIncidents([sailpoint, sharepoint], []);

    const same = pairs.filter((p) => p.label === 'same_event');
    const different = pairs.filter((p) => p.label === 'different_event');

    expect(same).toHaveLength(6); // C(3,2) * 2
    expect(different).toHaveLength(9); // 3 * 3
    expect(pairs.every((p) => p.label !== 'uncertain')).toBe(true);

    const ab = same.find(
      (p) => canonicalPairKey(p.urlA, p.urlB) === canonicalPairKey(
        'https://example.test/a',
        'https://example.test/b'
      )
    );
    expect(ab?.goldIncidentId).toBe('sp');
    expect(ab?.humanReason).toMatch(/gold incident/i);

    const ad = different.find(
      (p) => canonicalPairKey(p.urlA, p.urlB) === canonicalPairKey(
        'https://example.test/a',
        'https://example.test/d'
      )
    );
    expect(ad?.goldIncidentId).toBeNull();
    expect(ad?.humanReason).toMatch(/across gold/i);
  });

  it('applies uncertain overrides over derived labels', () => {
    const sailpoint = incident('sp', 'SailPoint', ['a', 'b']);
    const sharepoint = incident('sh', 'SharePoint', ['d', 'e']);

    const pairs = deriveGroupingPairsFromGoldIncidents(
      [sailpoint, sharepoint],
      [
        {
          urlA: 'https://example.test/a',
          urlB: 'https://example.test/b',
          label: 'uncertain',
          humanReason: 'Ambiguous coverage overlap.',
        },
        {
          urlA: 'https://example.test/d',
          urlB: 'https://example.test/a',
          label: 'uncertain',
          humanReason: 'Cross pair unclear.',
        },
      ]
    );

    const ab = pairs.find(
      (p) => canonicalPairKey(p.urlA, p.urlB) === canonicalPairKey(
        'https://example.test/a',
        'https://example.test/b'
      )
    );
    const ad = pairs.find(
      (p) => canonicalPairKey(p.urlA, p.urlB) === canonicalPairKey(
        'https://example.test/a',
        'https://example.test/d'
      )
    );

    expect(ab?.label).toBe('uncertain');
    expect(ab?.humanReason).toBe('Ambiguous coverage overlap.');
    expect(ad?.label).toBe('uncertain');
    expect(ad?.humanReason).toBe('Cross pair unclear.');
  });

  it('with one gold incident only derives same_event pairs', () => {
    const sailpoint = incident('sp', 'SailPoint', ['a', 'b', 'c']);
    const pairs = deriveGroupingPairsFromGoldIncidents([sailpoint], []);
    expect(pairs).toHaveLength(3);
    expect(pairs.every((p) => p.label === 'same_event')).toBe(true);
  });

  it('ignores non-uncertain override rows', () => {
    const sailpoint = incident('sp', 'SailPoint', ['a', 'b']);
    const pairs = deriveGroupingPairsFromGoldIncidents(
      [sailpoint],
      [
        {
          urlA: 'https://example.test/a',
          urlB: 'https://example.test/b',
          label: 'different_event',
          humanReason: 'Stale materialized label.',
        },
      ]
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].label).toBe('same_event');
  });
});
