import { env } from './env.js';

interface MiniMaxEmbeddingResponse {
  vectors: number[][] | null;
  base_resp?: { status_code: number; status_msg: string };
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
 */

export type EmbeddingType = 'db' | 'query' | 'passage' | 'document';

export async function embed(texts: string[], type: EmbeddingType = 'db'): Promise<number[][]> {
  if (texts.length === 0) return [];

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

  if (cachedDimensions === null && data.vectors[0]) {
    cachedDimensions = data.vectors[0].length;
  }

  return data.vectors;
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
