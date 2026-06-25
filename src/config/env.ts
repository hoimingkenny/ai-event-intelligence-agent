import 'dotenv/config';

export const env = {
  minimaxApiKey: process.env.MINIMAX_API_KEY ?? '',
  minimaxBaseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.chat/v1',
  minimaxModel: process.env.MINIMAX_MODEL ?? 'MiniMax-text-01',
  minimaxEmbeddingModel: process.env.MINIMAX_EMBEDDING_MODEL ?? 'embo-01',
  qdrantUrl: process.env.QDRANT_URL ?? 'http://localhost:6333',
  qdrantApiKey: process.env.QDRANT_API_KEY ?? '',
  qdrantCollection: process.env.QDRANT_COLLECTION ?? 'security_events',
  dedupSimilarityThreshold: Number(process.env.DEDUP_SIMILARITY_THRESHOLD ?? 0.82),
  searchContextSize: process.env.SEARCH_CONTEXT_SIZE ?? 'medium',
  monitorLookbackHours: Number(process.env.MONITOR_LOOKBACK_HOURS ?? 6),
};
