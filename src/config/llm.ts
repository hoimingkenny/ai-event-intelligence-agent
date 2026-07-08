import OpenAI from 'openai';
import { env } from './env.js';

export const llm = new OpenAI({
  apiKey: env.minimaxApiKey || 'missing-api-key',
  baseURL: env.minimaxBaseUrl,
  timeout: env.llmTimeoutMs,
  maxRetries: 1,
});

export const model = env.minimaxModel;
