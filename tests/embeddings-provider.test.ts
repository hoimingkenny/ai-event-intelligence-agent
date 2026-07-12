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
    process.env.EMBEDDING_DIMENSIONS = '1536';

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
          dimensions: 1536,
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

  it('calls Ollama /api/embed when EMBEDDING_PROVIDER=ollama', async () => {
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    process.env.OLLAMA_EMBEDDING_MODEL = 'qwen3-embedding:4b';
    process.env.EMBEDDING_DIMENSIONS = '1536';

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          embeddings: [
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
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
      'http://127.0.0.1:11434/api/embed',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'qwen3-embedding:4b',
          input: ['first text', 'second text'],
          dimensions: 1536,
        }),
      })
    );
  });

  it('truncates oversized Ollama vectors to EMBEDDING_DIMENSIONS', async () => {
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    process.env.OLLAMA_EMBEDDING_MODEL = 'qwen3-embedding:4b';
    process.env.EMBEDDING_DIMENSIONS = '2';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ embeddings: [[3, 4, 0]] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const { embedOne } = await import('../src/config/embeddings.js');
    await expect(embedOne('hello')).resolves.toEqual([0.6, 0.8]);
  });

  it('surfaces Ollama embedding errors', async () => {
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'model not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const { embedOne } = await import('../src/config/embeddings.js');
    await expect(embedOne('hello')).rejects.toThrow('Embedding request failed: model not found');
  });
});
