import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  appendGroupingPairLabel,
  canonicalPairKey,
  expandGoldIncidentPairs,
  loadGroupingPairDataset,
  type GroupingPairLabelRecord,
} from '../eval/grouping/pair-dataset.js';

const basePair: GroupingPairLabelRecord = {
  urlA: 'https://example.test/a',
  urlB: 'https://example.test/b',
  label: 'uncertain',
  humanReason: 'Ambiguous whether same incident.',
  goldIncidentId: 'inc-1',
  labeledAt: '2026-07-12T12:00:00.000Z',
};

describe('canonicalPairKey', () => {
  it('orders URLs so A|B equals B|A', () => {
    const a = 'https://example.test/a';
    const b = 'https://example.test/b';
    expect(canonicalPairKey(a, b)).toBe(canonicalPairKey(b, a));
    expect(canonicalPairKey(a, b)).toBe(`${a}\0${b}`);
  });
});

describe('expandGoldIncidentPairs', () => {
  it('expands three article URLs into three unordered pairs', () => {
    const pairs = expandGoldIncidentPairs([
      'https://example.test/a',
      'https://example.test/c',
      'https://example.test/b',
    ]);

    expect(pairs).toHaveLength(3);
    expect(pairs.map((p) => canonicalPairKey(p.urlA, p.urlB)).sort()).toEqual([
      canonicalPairKey('https://example.test/a', 'https://example.test/b'),
      canonicalPairKey('https://example.test/a', 'https://example.test/c'),
      canonicalPairKey('https://example.test/b', 'https://example.test/c'),
    ].sort());
  });

  it('returns one pair for two articles and none for fewer', () => {
    expect(expandGoldIncidentPairs(['https://example.test/a', 'https://example.test/b'])).toHaveLength(1);
    expect(expandGoldIncidentPairs(['https://example.test/a'])).toHaveLength(0);
  });
});

describe('grouping pair JSONL dataset', () => {
  it('loads labels and normalizes URL order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'grouping-pair-'));
    const path = join(dir, 'pairs.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        ...basePair,
        urlA: 'https://example.test/z',
        urlB: 'https://example.test/a',
      })}\n`
    );

    const samples = await loadGroupingPairDataset(path);
    expect(samples).toHaveLength(1);
    expect(samples[0].urlA).toBe('https://example.test/a');
    expect(samples[0].urlB).toBe('https://example.test/z');
    expect(samples[0].label).toBe('uncertain');
  });

  it('rejects duplicate unordered pairs on append', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'grouping-pair-'));
    const path = join(dir, 'pairs.jsonl');
    await appendGroupingPairLabel(path, basePair);
    await expect(
      appendGroupingPairLabel(path, {
        ...basePair,
        urlA: basePair.urlB,
        urlB: basePair.urlA,
        humanReason: 'Duplicate attempt.',
      })
    ).rejects.toThrow(/duplicate/i);

    const raw = await readFile(path, 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(1);
  });

  it('loads an empty dataset file as zero pairs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'grouping-pair-'));
    const path = join(dir, 'empty.jsonl');
    await writeFile(path, '');
    expect(await loadGroupingPairDataset(path)).toEqual([]);
  });

  it('upserts replace an existing unordered pair label', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'grouping-pair-'));
    const path = join(dir, 'pairs.jsonl');
    await appendGroupingPairLabel(path, basePair);
    const { upsertGroupingPairLabel } = await import('../eval/grouping/pair-dataset.js');
    const result = await upsertGroupingPairLabel(path, {
      ...basePair,
      urlA: basePair.urlB,
      urlB: basePair.urlA,
      label: 'uncertain',
      humanReason: 'Changed mind after review.',
    });
    expect(result.created).toBe(false);
    expect(result.pair.label).toBe('uncertain');
    const samples = await loadGroupingPairDataset(path);
    expect(samples).toHaveLength(1);
    expect(samples[0].humanReason).toBe('Changed mind after review.');
  });
});
