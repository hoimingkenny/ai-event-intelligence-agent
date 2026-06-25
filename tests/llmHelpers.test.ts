import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callLLMWithSchema } from '../src/agents/llmHelpers.js';
import { env } from '../src/config/env.js';

const hasKey = Boolean(env.minimaxApiKey);

describe.skipIf(!hasKey)('LLM helper (MiniMax)', () => {
  it('returns parsed JSON matching a zod schema', async () => {
    const schema = z.object({
      status: z.literal('ok'),
      number: z.number().int().min(1).max(100),
    });

    const result = await callLLMWithSchema(
      'You are a test assistant. Always reply with valid JSON matching the requested schema.',
      'Return JSON: status="ok", number is a random integer between 1 and 100.',
      schema
    );

    expect(result.status).toBe('ok');
    expect(result.number).toBeGreaterThanOrEqual(1);
    expect(result.number).toBeLessThanOrEqual(100);
  });

  it('handles nested array schemas', async () => {
    const schema = z.object({
      tags: z.array(z.string()).min(2).max(5),
    });

    const result = await callLLMWithSchema(
      'You are a test assistant. Always reply with valid JSON. The JSON must be a single top-level object with a key "tags" whose value is an array of strings.',
      'Generate exactly 3 short single-word tags for the topic "cybersecurity". Return a JSON object with shape {"tags": ["...", "...", "..."]}.',
      schema
    );

    expect(result.tags).toHaveLength(3);
    for (const tag of result.tags) {
      expect(typeof tag).toBe('string');
      expect(tag.length).toBeGreaterThan(0);
    }
  });

  it('throws when the schema does not match', async () => {
    const schema = z.object({
      answer: z.literal('forty-two'),
    });

    await expect(
      callLLMWithSchema(
        'You are a test assistant. Always reply with valid JSON matching the requested schema.',
        'Return JSON with a field "answer" set to "hello".',
        schema
      )
    ).rejects.toThrow();
  });
});
