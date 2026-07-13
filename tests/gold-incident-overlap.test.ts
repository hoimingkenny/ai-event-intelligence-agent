import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  ArticleInMultipleGoldIncidentsError,
  loadGoldIncidents,
  upsertGoldIncident,
} from '../eval/grouping/gold-incidents.js';

const article = (id: string, path: string) => ({
  articleId: id,
  url: `https://example.test/${path}`,
  title: path,
  sourceName: 'Test',
});

describe('upsertGoldIncident overlap guard', () => {
  it('rejects an article URL already used in another gold incident', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gold-overlap-'));
    const path = join(dir, 'gold.jsonl');

    await upsertGoldIncident(path, {
      name: 'SailPoint',
      articles: [article('1', 'a'), article('2', 'b')],
    });

    await expect(
      upsertGoldIncident(path, {
        name: 'SharePoint',
        articles: [article('3', 'a'), article('4', 'd')],
      })
    ).rejects.toBeInstanceOf(ArticleInMultipleGoldIncidentsError);

    const incidents = await loadGoldIncidents(path);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].name).toBe('SailPoint');
  });

  it('allows updating the same incident that already owns the URL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gold-overlap-'));
    const path = join(dir, 'gold.jsonl');

    const first = await upsertGoldIncident(path, {
      name: 'SailPoint',
      articles: [article('1', 'a'), article('2', 'b')],
    });

    const updated = await upsertGoldIncident(path, {
      id: first.id,
      name: 'SailPoint updated',
      articles: [article('1', 'a'), article('2', 'b'), article('3', 'c')],
    });

    expect(updated.name).toBe('SailPoint updated');
    expect(updated.articles).toHaveLength(3);
    expect(await loadGoldIncidents(path)).toHaveLength(1);
  });
});
