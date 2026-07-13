import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  appendGroupingPairLabel,
  deleteGroupingPairOverride,
  loadGroupingPairDataset,
  upsertGroupingPairLabel,
} from '../eval/grouping/pair-dataset.js';

describe('grouping pair overrides (uncertain only)', () => {
  it('rejects persisting same_event or different_event labels', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pair-override-'));
    const path = join(dir, 'pairs.jsonl');

    await expect(
      appendGroupingPairLabel(path, {
        urlA: 'https://example.test/a',
        urlB: 'https://example.test/b',
        label: 'same_event',
        humanReason: 'Should not persist derived labels.',
      })
    ).rejects.toThrow(/uncertain/i);

    await expect(
      upsertGroupingPairLabel(path, {
        urlA: 'https://example.test/a',
        urlB: 'https://example.test/c',
        label: 'different_event',
        humanReason: 'Should not persist derived labels.',
      })
    ).rejects.toThrow(/uncertain/i);

    expect(await loadGroupingPairDataset(path)).toEqual([]);
  });

  it('upserts and deletes uncertain overrides', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pair-override-'));
    const path = join(dir, 'pairs.jsonl');

    const created = await upsertGroupingPairLabel(path, {
      urlA: 'https://example.test/b',
      urlB: 'https://example.test/a',
      label: 'uncertain',
      humanReason: 'Ambiguous pair.',
    });
    expect(created.created).toBe(true);
    expect(created.pair.urlA).toBe('https://example.test/a');

    const deleted = await deleteGroupingPairOverride(
      path,
      'https://example.test/b',
      'https://example.test/a'
    );
    expect(deleted).toBe(true);
    expect(await loadGroupingPairDataset(path)).toEqual([]);

    const raw = await readFile(path, 'utf8');
    expect(raw.trim()).toBe('');
  });

  it('ignores legacy same_event rows when appending an uncertain override', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pair-override-'));
    const path = join(dir, 'pairs.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        urlA: 'https://example.test/a',
        urlB: 'https://example.test/b',
        label: 'same_event',
        humanReason: 'Legacy materialized label.',
      })}\n`
    );

    const saved = await appendGroupingPairLabel(path, {
      urlA: 'https://example.test/a',
      urlB: 'https://example.test/b',
      label: 'uncertain',
      humanReason: 'Now an override.',
    });
    expect(saved.label).toBe('uncertain');

    const rows = await loadGroupingPairDataset(path);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('uncertain');
  });
});
