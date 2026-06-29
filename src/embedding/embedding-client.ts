import { embedOne } from '../config/embeddings.js';

export interface EmbeddingClient {
  embedDocument(text: string): Promise<number[]>;
}

export class MiniMaxEmbeddingClient implements EmbeddingClient {
  async embedDocument(text: string): Promise<number[]> {
    return embedOne(text, 'db');
  }
}

export function buildArticleEmbeddingText(input: {
  title?: string | null;
  cleanText?: string | null;
  rssSummary?: string | null;
}): string {
  return [input.title, input.rssSummary, input.cleanText].filter(Boolean).join('\n').slice(0, 12000);
}
