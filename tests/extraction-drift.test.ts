import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import { checkExtractionDrift, median } from '../src/monitoring/extraction-drift.js';
import { wordRecall } from '../src/utils/word-overlap.js';

function stubDb(rows: unknown[]): Queryable {
  return {
    async query<T>() {
      return { rows: rows as T[], rowCount: rows.length };
    },
  } as Queryable;
}

function rowsFor(
  source: string,
  recalls: Array<number | null>,
  status = 'http_success'
): unknown[] {
  return recalls.map((recall) => ({
    source_name: source,
    rss_recall: recall,
    content_quality_score: 0.8,
    extraction_status: status,
  }));
}

describe('checkExtractionDrift', () => {
  it('reports healthy sources as not drifted', async () => {
    const db = stubDb(rowsFor('Krebs on Security', [0.95, 0.9, 0.92, 0.97, 0.88, 0.93]));
    const result = await checkExtractionDrift(db);

    expect(result.driftedSources).toEqual([]);
    expect(result.sources[0]).toMatchObject({
      sourceName: 'Krebs on Security',
      drifted: false,
      medianRecall: expect.closeTo(0.925, 2),
    });
  });

  it('flags a source whose median recall collapsed (site redesign)', async () => {
    const db = stubDb([
      ...rowsFor('Bleeping Computer', [0.2, 0.15, 0.3, 0.25, 0.1, 0.22]),
      ...rowsFor('Krebs on Security', [0.95, 0.9, 0.92, 0.97, 0.88]),
    ]);
    const result = await checkExtractionDrift(db);

    expect(result.driftedSources).toEqual(['Bleeping Computer']);
    expect(result.sources.find((s) => s.sourceName === 'Bleeping Computer')?.reasons[0]).toMatch(
      /median_recall/
    );
  });

  it('flags a source with a high extraction failure rate', async () => {
    const db = stubDb(rowsFor('The Hacker News', [null, null, null, null, null, null], 'http_failed'));
    const result = await checkExtractionDrift(db);

    expect(result.driftedSources).toEqual(['The Hacker News']);
    expect(result.sources[0].reasons[0]).toMatch(/failure_rate/);
  });

  it('does not judge sources below the minimum sample size', async () => {
    const db = stubDb(rowsFor('Quiet Feed', [0.1, 0.05]));
    const result = await checkExtractionDrift(db);

    expect(result.driftedSources).toEqual([]);
    expect(result.sources[0].sampled).toBe(2);
  });

  it('handles numeric values returned as strings by pg', async () => {
    const db = stubDb([
      { source_name: 'S', rss_recall: '0.10', content_quality_score: '0.9', extraction_status: 'http_success' },
      { source_name: 'S', rss_recall: '0.20', content_quality_score: '0.9', extraction_status: 'http_success' },
      { source_name: 'S', rss_recall: '0.15', content_quality_score: '0.9', extraction_status: 'http_success' },
      { source_name: 'S', rss_recall: '0.12', content_quality_score: '0.9', extraction_status: 'http_success' },
      { source_name: 'S', rss_recall: '0.18', content_quality_score: '0.9', extraction_status: 'http_success' },
    ]);
    const result = await checkExtractionDrift(db);

    expect(result.driftedSources).toEqual(['S']);
  });
});

describe('median', () => {
  it('handles odd, even, and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('wordRecall as extraction ground truth', () => {
  it('scores high when extraction contains the RSS summary', () => {
    const summary = 'CISA confirmed that ransomware gangs are exploiting a Defender privilege escalation flaw.';
    const article = `${summary} The flaw, dubbed BlueHammer, was leaked in April with proof-of-concept code.`;
    expect(wordRecall(summary, article)).toBe(1);
  });

  it('scores low when extraction grabbed the wrong part of the page', () => {
    const summary = 'CISA confirmed that ransomware gangs are exploiting a Defender privilege escalation flaw.';
    const wrongContent = 'Subscribe to our newsletter. Popular stories. Follow us on social media for updates.';
    expect(wordRecall(summary, wrongContent)).toBeLessThan(0.2);
  });
});
