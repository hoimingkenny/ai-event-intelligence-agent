import { z } from 'zod';
import { llm, model } from '../config/llm.js';

export interface LLMCallOptions {
  temperature?: number;
  maxRetries?: number;
}

/**
 * Calls MiniMax with a system+user prompt and parses the response as JSON against a zod schema.
 * Throws on parse failure or empty response. Caller is responsible for fallback handling.
 */
export async function callLLMWithSchema<T extends z.ZodTypeAny>(
  systemPrompt: string,
  userPrompt: string,
  schema: T,
  options: LLMCallOptions = {}
): Promise<z.infer<T>> {
  const completion = await llm.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: options.temperature ?? 0.2,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Empty LLM response');

  // MiniMax models can prepend a `<think>...</think>` reasoning block and/or wrap the JSON
  // in markdown code fences, even when response_format: json_object is set. Strip both
  // before parsing.
  const stripped = content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, '$1')
    .trim();

  const parsed = JSON.parse(stripped);
  return schema.parse(parsed);
}
