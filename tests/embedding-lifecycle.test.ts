import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('embedding lifecycle', () => {
  it('copies creating-article vector onto a new event with provenance', async () => {
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.OLLAMA_EMBEDDING_MODEL = 'qwen3-embedding:4b';
    process.env.EMBEDDING_DIMENSIONS = '3';

    const saved: unknown[][] = [];
    const db: Queryable = {
      async query(_sql, params) {
        if (String(_sql).includes('SELECT embedding::text') && String(_sql).includes('embedding_model')) {
          return { rows: [{ embedding: '[1,0,0]' }], rowCount: 1 };
        }
        if (String(_sql).includes('SET event_embedding = $2::vector')) {
          saved.push(params ?? []);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const { createEmbeddingLifecycle } = await import('../src/embedding/lifecycle.js');
    const lifecycle = createEmbeddingLifecycle(db);
    await lifecycle.copyArticleEmbeddingToEvent('event-1', 'article-1');

    expect(saved).toHaveLength(1);
    expect(saved[0]?.[0]).toBe('event-1');
    expect(saved[0]?.[1]).toBe('[1,0,0]');
    expect(saved[0]?.[2]).toBe('qwen3-embedding:4b');
    expect(saved[0]?.[3]).toBe(3);
  });

  it('refuses to copy when article embedding lacks current-model provenance', async () => {
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.OLLAMA_EMBEDDING_MODEL = 'qwen3-embedding:4b';
    process.env.EMBEDDING_DIMENSIONS = '3';

    const db: Queryable = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
    };

    const { createEmbeddingLifecycle } = await import('../src/embedding/lifecycle.js');
    const lifecycle = createEmbeddingLifecycle(db);
    await expect(lifecycle.copyArticleEmbeddingToEvent('event-1', 'article-1')).rejects.toThrow(
      /no current-model embedding/
    );
  });
});
