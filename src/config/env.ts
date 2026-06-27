import 'dotenv/config';

export const env = {
  minimaxApiKey: process.env.MINIMAX_API_KEY ?? '',
  minimaxBaseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.chat/v1',
  minimaxModel: process.env.MINIMAX_MODEL ?? 'MiniMax-text-01',
  minimaxEmbeddingModel: process.env.MINIMAX_EMBEDDING_MODEL ?? 'embo-01',
  databaseUrl: process.env.DATABASE_URL ?? '',
  pgVectorDimensions: Number(process.env.PGVECTOR_DIMENSIONS ?? 1536),
  redisHost: process.env.REDIS_HOST ?? 'localhost',
  redisPort: Number(process.env.REDIS_PORT ?? 6379),
  qdrantUrl: process.env.QDRANT_URL ?? 'http://localhost:6333',
  qdrantApiKey: process.env.QDRANT_API_KEY ?? '',
  qdrantCollection: process.env.QDRANT_COLLECTION ?? 'security_events',
  dedupSimilarityThreshold: Number(process.env.DEDUP_SIMILARITY_THRESHOLD ?? 0.82),
  searchContextSize: process.env.SEARCH_CONTEXT_SIZE ?? 'medium',
  monitorLookbackHours: Number(process.env.MONITOR_LOOKBACK_HOURS ?? 6),
  rssFetchIntervalMinutes: Number(process.env.RSS_FETCH_INTERVAL_MINUTES ?? 30),
  httpExtractionConcurrency: Number(process.env.HTTP_EXTRACTION_CONCURRENCY ?? 10),
  playwrightExtractionConcurrency: Number(process.env.PLAYWRIGHT_EXTRACTION_CONCURRENCY ?? 2),
  llmConcurrency: Number(process.env.LLM_CONCURRENCY ?? 3),
  alertSuppressionHours: Number(process.env.ALERT_SUPPRESSION_HOURS ?? 6),
  minAlertConfidence: Number(process.env.MIN_ALERT_CONFIDENCE ?? 0.75),
};
