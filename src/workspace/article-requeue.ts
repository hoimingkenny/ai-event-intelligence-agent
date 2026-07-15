import type { Queryable } from '../db/repositories/types.js';

export interface RequeueResult {
  articleId: string;
  processingStatus: 'NEW';
}

export class ArticleNotIgnorableError extends Error {
  constructor(
    public readonly articleId: string,
    message = `Article ${articleId} is not in IGNORED status and cannot be re-queued for filter.`
  ) {
    super(message);
    this.name = 'ArticleNotIgnorableError';
  }
}

/**
 * Filter re-queue seam (analyst-driven escape hatch per PRD #34).
 *
 * Sends a single `IGNORED` article back to the cheap filter by clearing the
 * previous decision and returning it to the `NEW` queue. The `WHERE
 * processing_status='IGNORED'` clause is the invariant guard: if another
 * caller already re-queued (or the article moved to any other status), the
 * UPDATE matches zero rows and we throw `ArticleNotIgnorableError` so the UI
 * surfaces a clear rejection instead of silently overwriting pipeline state.
 *
 * Not a bulk action. Does not start the pipeline — the next scheduled sweep
 * will pick the article up via `listByProcessingStatus('NEW', ...)`.
 */
export async function requeueArticleForFilter(
  db: Queryable,
  articleId: string
): Promise<RequeueResult> {
  const result = await db.query<{ id: string; processing_status: string }>(
    `
      UPDATE articles
      SET processing_status = 'NEW',
        processing_error = NULL,
        cheap_filter_decision = NULL,
        cheap_filter_score = NULL,
        cheap_filter_reasons = '{}',
        cheap_filter_blocking_reasons = '{}',
        cheap_filter_matched_signals = '{}'::jsonb,
        last_processed_at = now(),
        updated_at = now()
      WHERE id = $1
        AND processing_status = 'IGNORED'
      RETURNING id, processing_status
    `,
    [articleId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new ArticleNotIgnorableError(articleId);
  }

  return { articleId: row.id, processingStatus: 'NEW' };
}