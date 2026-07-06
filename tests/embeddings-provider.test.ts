import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  process.env = { ...originalEnv };
});

describe('embedding provider selection', () => {
  it('calls OpenRouter embeddings when EMBEDDING_PROVIDER=openrouter', async () => {
    process.env.EMBEDDING_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.OPENROUTER_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { embedding: [0.1, 0.2, 0.3] },
            { embedding: [0.4, 0.5, 0.6] },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { embed } = await import('../src/config/embeddings.js');
    const vectors = await embed(['first text', 'second text']);

    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-openrouter-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          model: 'openai/text-embedding-3-small',
          input: ['first text', 'second text'],
        }),
      })
    );
  });

  it('surfaces OpenRouter embedding errors', async () => {
    process.env.EMBEDDING_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'model does not support embeddings' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const { embedOne } = await import('../src/config/embeddings.js');
    await expect(embedOne('hello')).rejects.toThrow(
      'Embedding request failed: model does not support embeddings'
    );
  });
});
