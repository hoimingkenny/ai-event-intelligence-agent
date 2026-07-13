import { env } from './env.js';

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
 * Embedding providers:
 * - openrouter: OpenAI-compatible POST {baseURL}/embeddings
 * - ollama: native POST {baseURL}/api/embed
 *
 * MiniMax is LLM-only in this project (coding-plan keys cannot call embo-01).
 */

export type EmbeddingType = 'db' | 'query' | 'passage' | 'document';

export async function embed(texts: string[], _type: EmbeddingType = 'db'): Promise<number[][]> {
  if (texts.length === 0) return [];

  let raw: number[][];
  if (env.embeddingProvider === 'openrouter') {
    raw = await embedWithOpenRouter(texts);
  } else if (env.embeddingProvider === 'ollama') {
    raw = await embedWithOllama(texts);
  } else {
    throw new Error(
      `Unsupported EMBEDDING_PROVIDER="${env.embeddingProvider}". Use "openrouter" or "ollama".`
    );
  }

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

/** Model id written as vector provenance for the active embedding provider. */
export function currentEmbeddingModel(): string {
  if (env.embeddingProvider === 'openrouter') return env.openRouterEmbeddingModel;
  if (env.embeddingProvider === 'ollama') return env.ollamaEmbeddingModel;
  throw new Error(
    `Unsupported EMBEDDING_PROVIDER="${env.embeddingProvider}". Use "openrouter" or "ollama".`
  );
}

export function currentEmbeddingProvenance(): { model: string; dims: number } {
  return {
    model: currentEmbeddingModel(),
    dims: env.embeddingDimensions,
  };
}
