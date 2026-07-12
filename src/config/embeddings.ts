import { env } from './env.js';

interface MiniMaxEmbeddingResponse {
  vectors: number[][] | null;
  base_resp?: { status_code: number; status_msg: string };
}

interface OpenRouterEmbeddingResponse {
  data?: Array<{ embedding: number[] }>;
  error?: { message?: string };
}

interface OllamaEmbeddingResponse {
  embeddings?: number[][];
  error?: string;
}

let cachedDimensions: number | null = null;

/**
 * MiniMax uses a non-OpenAI-standard embeddings endpoint:
 *   POST {baseURL}/embeddings
 *   body: { model, type: 'db' | 'query' | ..., texts: string[] }
 *   response: { vectors: number[][], base_resp: { status_code, status_msg } }
 *
 * - `type` distinguishes indexed documents (`db`) from search-time queries (`query`).
 *   The model can produce asymmetric embeddings; pick the right type for each side.
 * - The standard OpenAI JS SDK `client.embeddings.create({ input })` does NOT work against
 *   this endpoint — go through fetch directly.
 *
 * Ollama uses its native embeddings endpoint:
 *   POST {baseURL}/api/embed
 *   body: { model, input: string[], dimensions?: number }
 *   response: { embeddings: number[][] }
 */

export type EmbeddingType = 'db' | 'query' | 'passage' | 'document';

export async function embed(texts: string[], type: EmbeddingType = 'db'): Promise<number[][]> {
  if (texts.length === 0) return [];

  const raw =
    env.embeddingProvider === 'openrouter'
      ? await embedWithOpenRouter(texts)
      : env.embeddingProvider === 'ollama'
        ? await embedWithOllama(texts)
        : await embedWithMiniMax(texts, type);

  const vectors = raw.map(truncateToConfiguredDimensions);

  if (cachedDimensions === null && vectors[0]) {
    cachedDimensions = vectors[0].length;
  }

  return vectors;
}

/**
 * Enforce env.embeddingDimensions on every vector. Providers may ignore a
 * `dimensions` request; Matryoshka-trained models remain valid under
 * truncate-then-renormalize. Vectors already at or below the target pass
 * through untouched.
 */
function truncateToConfiguredDimensions(vector: number[]): number[] {
  const target = env.embeddingDimensions;
  if (!Number.isFinite(target) || target <= 0 || vector.length <= target) return vector;

  const truncated = vector.slice(0, target);
  const norm = Math.sqrt(truncated.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return truncated;
  return truncated.map((value) => value / norm);
}

async function embedWithMiniMax(texts: string[], type: EmbeddingType): Promise<number[][]> {

  const resp = await fetch(`${env.minimaxBaseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.minimaxApiKey}`,
    },
    body: JSON.stringify({
      model: env.minimaxEmbeddingModel,
      type,
      texts,
    }),
  });

  const data = (await resp.json()) as MiniMaxEmbeddingResponse;
  if (!resp.ok || !data.vectors) {
    const msg = data.base_resp?.status_msg ?? `HTTP ${resp.status}`;
    throw new Error(`Embedding request failed: ${msg}`);
  }

  return data.vectors;
}

async function embedWithOpenRouter(texts: string[]): Promise<number[][]> {
  const resp = await fetch(`${env.openRouterBaseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.openRouterApiKey}`,
      'HTTP-Referer': 'https://vendor-threat-watch.local',
      'X-Title': 'Vendor Threat Watch',
    },
    body: JSON.stringify({
      model: env.openRouterEmbeddingModel,
      input: texts,
      dimensions: env.embeddingDimensions,
    }),
  });

  const data = (await resp.json()) as OpenRouterEmbeddingResponse;
  if (!resp.ok || !data.data) {
    const msg = data.error?.message ?? `HTTP ${resp.status}`;
    throw new Error(`Embedding request failed: ${msg}`);
  }

  return data.data.map((item) => item.embedding);
}

async function embedWithOllama(texts: string[]): Promise<number[][]> {
  const resp = await fetch(`${env.ollamaBaseUrl}/api/embed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.ollamaEmbeddingModel,
      input: texts,
      dimensions: env.embeddingDimensions,
    }),
  });

  const data = (await resp.json()) as OllamaEmbeddingResponse;
  if (!resp.ok || !data.embeddings) {
    const msg = data.error ?? `HTTP ${resp.status}`;
    throw new Error(`Embedding request failed: ${msg}`);
  }

  return data.embeddings;
}

export async function embedOne(text: string, type: EmbeddingType = 'db'): Promise<number[]> {
  const [vec] = await embed([text], type);
  if (!vec) throw new Error('Empty embedding result');
  return vec;
}

export async function getEmbeddingDimensions(): Promise<number> {
  if (cachedDimensions !== null) return cachedDimensions;
  await embedOne('dimension probe', 'query');
  if (cachedDimensions === null) throw new Error('Failed to detect embedding dimensions');
  return cachedDimensions;
}

export function resetEmbeddingDimensionsCache(): void {
  cachedDimensions = null;
}
