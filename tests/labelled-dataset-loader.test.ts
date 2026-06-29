import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLabelledDataset } from '../src/evaluation/labelled-dataset-loader.js';

describe('loadLabelledDataset', () => {
  it('loads the sample labelled evaluation dataset', async () => {
    const dataset = await loadLabelledDataset(join(process.cwd(), 'data/labelled-eval-set.json'));

    expect(dataset.length).toBeGreaterThan(0);
    expect(dataset[0].article_id).toBe('sample-001');
  });
});
