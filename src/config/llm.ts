import OpenAI from 'openai';
import { env } from './env.js';

export const llm = new OpenAI({
  apiKey: env.minimaxApiKey,
  baseURL: env.minimaxBaseUrl,
});

export const model = env.minimaxModel;