import { describe, expect, it } from 'vitest';
import { vectorToSqlLiteral } from '../src/db/repositories/article.repository.js';
import { buildArticleEmbeddingText } from '../src/embedding/embedding-client.js';

describe('embedding helpers', () => {
  it('serializes vectors for pgvector parameters', () => {
    expect(vectorToSqlLiteral([0.1, -2, 3])).toBe('[0.1,-2,3]');
  });

  it('builds bounded embedding text from article fields', () => {
    const text = buildArticleEmbeddingText({
      title: 'Vendor advisory',
      rssSummary: 'Summary',
      cleanText: 'A'.repeat(13000),
    });

    expect(text.startsWith('Vendor advisory\nSummary\n')).toBe(true);
    expect(text.length).toBe(12000);
  });
});
