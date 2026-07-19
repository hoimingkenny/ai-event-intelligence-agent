import pino from 'pino';

const sensitiveKeyPattern = /(api[_-]?key|token|secret|password|authorization)/i;

export function redactLogObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactLogObject);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveKeyPattern.test(key) ? '[REDACTED]' : redactLogObject(entry),
      ])
    );
  }

  return value;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['*.apiKey', '*.api_key', '*.token', '*.secret', '*.password', '*.authorization'],
    censor: '[REDACTED]',
  },
});

export function logInfo(bindings: Record<string, unknown>, message: string): void {
  logger.info(redactLogObject(bindings), message);
}

export function logWarn(bindings: Record<string, unknown>, message: string): void {
  logger.warn(redactLogObject(bindings), message);
}

export function logError(bindings: Record<string, unknown>, message: string): void {
  logger.error(redactLogObject(bindings), message);
}

/** Batch of article ids a pipeline stage is about to process. */
export function logStageBatch(
  stage: string,
  action: string,
  articleIds: string[],
  extra: Record<string, unknown> = {}
): void {
  logInfo({ stage, action, articleIds, count: articleIds.length, ...extra }, 'pipeline_stage_batch');
}

/** One article-level action inside a pipeline stage. */
export function logStageArticle(
  stage: string,
  articleId: string,
  action: string,
  extra: Record<string, unknown> = {}
): void {
  logInfo({ stage, articleId, action, ...extra }, 'pipeline_stage_article');
}
