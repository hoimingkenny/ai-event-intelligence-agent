import 'dotenv/config';
import { installHttpProxyFromEnv } from './http-proxy.js';

installHttpProxyFromEnv();

export const env = {
  minimaxApiKey: process.env.MINIMAX_API_KEY ?? '',
  minimaxBaseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.chat/v1',
  minimaxModel: process.env.MINIMAX_MODEL ?? 'MiniMax-text-01',
  embeddingProvider: process.env.EMBEDDING_PROVIDER ?? 'openrouter',
  embeddingBatchSize: Number(process.env.EMBEDDING_BATCH_SIZE ?? 8),
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  openRouterEmbeddingModel: process.env.OPENROUTER_EMBEDDING_MODEL ?? 'qwen/qwen3-embedding-8b',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? 'qwen3-embedding:4b',
  // Keep in sync with PGVECTOR_DIMENSIONS (and any vector(...) migration).
  // Ollama qwen3-embedding:4b is native 2560; request/truncate to stay ≤2000 for HNSW.
  embeddingDimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? process.env.PGVECTOR_DIMENSIONS ?? 2048),
  embeddingMaxRetries: Number(process.env.EMBEDDING_MAX_RETRIES ?? 5),
  databaseUrl: process.env.DATABASE_URL ?? '',
  pgVectorDimensions: Number(process.env.PGVECTOR_DIMENSIONS ?? 2048),
  redisHost: process.env.REDIS_HOST ?? 'localhost',
  redisPort: Number(process.env.REDIS_PORT ?? 6379),
  rssFetchIntervalMinutes: Number(process.env.RSS_FETCH_INTERVAL_MINUTES ?? 30),
  httpExtractionConcurrency: Number(process.env.HTTP_EXTRACTION_CONCURRENCY ?? 10),
  playwrightExtractionConcurrency: Number(process.env.PLAYWRIGHT_EXTRACTION_CONCURRENCY ?? 2),
  playwrightExtractionTimeoutMs: Number(process.env.PLAYWRIGHT_EXTRACTION_TIMEOUT_MS ?? 15000),
  playwrightMinTextLength: Number(process.env.PLAYWRIGHT_MIN_TEXT_LENGTH ?? 250),
  llmConcurrency: Number(process.env.LLM_CONCURRENCY ?? 5),
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
  alertSuppressionHours: Number(process.env.ALERT_SUPPRESSION_HOURS ?? 6),
  earlyWarningWindowHours: Number(process.env.EARLY_WARNING_WINDOW_HOURS ?? 24),
  alertLatencySloHours: Number(process.env.ALERT_LATENCY_SLO_HOURS ?? 2),
  minAlertConfidence: Number(process.env.MIN_ALERT_CONFIDENCE ?? 0.75),
};
