import OpenAI from 'openai';
import { env } from './env.js';

export const llm = new OpenAI({
  apiKey: env.minimaxApiKey || 'missing-api-key',
  baseURL: env.minimaxBaseUrl,
});

export const model = env.minimaxModel;
