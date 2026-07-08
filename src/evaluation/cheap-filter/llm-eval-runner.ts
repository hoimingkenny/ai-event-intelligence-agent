import { z } from 'zod';
import { llm, model } from '../../config/llm.js';
import {
  buildCheapFilterLlmEvalPrompt,
  buildCheapFilterLlmEvalRepairPrompt,
  CHEAP_FILTER_LLM_EVAL_PROMPT_VERSION,
} from './llm-eval-prompt.js';
import {
  CheapFilterLlmEvaluationSchema,
  type CheapFilterEvalInput,
  type CheapFilterLlmEvaluation,
} from './llm-eval-types.js';

const MAX_PARSE_RETRIES = 1;

export interface LlmEvalRunnerOptions {
  /** Override model name (defaults to the global MiniMax model). */
  modelName?: string;
  temperature?: number;
  /** Inject a custom LLM caller (used by tests). */
  caller?: LlmCaller;
}

export type LlmCaller = (params: {
  systemPrompt: string;
  userPrompt: string;
  modelName: string;
  temperature: number;
}) => Promise<string>;

export interface LlmEvalRunResult {
  evaluation: CheapFilterLlmEvaluation;
  rawResponses: string[];
  parseRetries: number;
  modelName: string;
  promptVersion: string;
}

export class LlmEvalParseFailure extends Error {
  constructor(
    message: string,
    public readonly rawResponses: string[],
    public readonly validationErrors: string[]
  ) {
    super(message);
    this.name = 'LlmEvalParseFailure';
  }
}

const defaultCaller: LlmCaller = async ({ systemPrompt, userPrompt, modelName, temperature }) => {
  const completion = await llm.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Empty LLM response');
  return content;
};

function stripWrappers(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, '$1')
    .trim();
}

function safeParse(content: string): unknown {
  return JSON.parse(stripWrappers(content));
}

function validate(parsed: unknown, articleId: string): {
  evaluation?: CheapFilterLlmEvaluation;
  errorMessage?: string;
} {
  const result = CheapFilterLlmEvaluationSchema.safeParse(parsed);
  if (!result.success) {
    return { errorMessage: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  if (result.data.articleId !== articleId) {
    return { errorMessage: `articleId mismatch: expected ${articleId}, got ${result.data.articleId}` };
  }
  if (result.data.scoreAssessment === 'REASONABLE' && result.data.recommendedScoreBand !== null) {
    return {
      errorMessage:
        'recommendedScoreBand must be null when scoreAssessment is REASONABLE',
    };
  }
  if (
    result.data.scoreAssessment !== 'REASONABLE' &&
    result.data.recommendedScoreBand === null
  ) {
    return {
      errorMessage:
        'recommendedScoreBand must be set when scoreAssessment is TOO_HIGH or TOO_LOW',
    };
  }
  return { evaluation: normalizeEvaluation(result.data) };
}

// Collapse whitespace in free-form string arrays so the LLM's occasional
// habit of returning "k\ne\ny\nw\n..." renders as a single suggestion.
function normalizeEvaluation(evaluation: CheapFilterLlmEvaluation): CheapFilterLlmEvaluation {
  const collapse = (values: string[]): string[] =>
    values
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .filter((value) => value.length > 0);
  return {
    ...evaluation,
    suggestedRuleChanges: collapse(evaluation.suggestedRuleChanges),
    suggestedKeywordsToAdd: collapse(evaluation.suggestedKeywordsToAdd),
    suggestedVendorProductAliasesToAdd: collapse(evaluation.suggestedVendorProductAliasesToAdd),
  };
}

export async function runCheapFilterLlmEval(
  input: CheapFilterEvalInput,
  options: LlmEvalRunnerOptions = {}
): Promise<LlmEvalRunResult> {
  const { systemPrompt, userPrompt, promptVersion } = buildCheapFilterLlmEvalPrompt(input);
  const modelName = options.modelName ?? model;
  const temperature = options.temperature ?? 0.1;
  const caller = options.caller ?? defaultCaller;

  const rawResponses: string[] = [];
  let parseRetries = 0;

  let lastRaw = '';
  try {
    lastRaw = await caller({ systemPrompt, userPrompt, modelName, temperature });
    rawResponses.push(lastRaw);
  } catch (error) {
    throw new LlmEvalParseFailure(
      `LLM call failed: ${(error as Error).message}`,
      rawResponses,
      []
    );
  }

  let { evaluation, errorMessage } = validate(safeParse(lastRaw), input.articleId);

  while (!evaluation && parseRetries < MAX_PARSE_RETRIES) {
    parseRetries += 1;
    const repairUserPrompt = buildCheapFilterLlmEvalRepairPrompt(userPrompt, lastRaw, errorMessage ?? 'unknown');
    try {
      lastRaw = await caller({ systemPrompt, userPrompt: repairUserPrompt, modelName, temperature });
      rawResponses.push(lastRaw);
    } catch (error) {
      throw new LlmEvalParseFailure(
        `LLM repair call failed: ${(error as Error).message}`,
        rawResponses,
        errorMessage ? [errorMessage] : []
      );
    }

    let parsed: unknown;
    try {
      parsed = safeParse(lastRaw);
    } catch (err) {
      errorMessage = `JSON parse error: ${(err as Error).message}`;
      continue;
    }
    const validated = validate(parsed, input.articleId);
    evaluation = validated.evaluation;
    errorMessage = validated.errorMessage;
  }

  if (!evaluation) {
    throw new LlmEvalParseFailure(
      `LLM response failed validation after ${MAX_PARSE_RETRIES} repair attempt(s)`,
      rawResponses,
      errorMessage ? [errorMessage] : []
    );
  }

  return {
    evaluation,
    rawResponses,
    parseRetries,
    modelName,
    promptVersion,
  };
}

// Re-export the prompt version for callers that need to persist it.
export { CHEAP_FILTER_LLM_EVAL_PROMPT_VERSION };