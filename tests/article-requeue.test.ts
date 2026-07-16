import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import {
  ArticleNotIgnorableError,
  requeueArticleForFilter,
} from '../src/workspace/article-requeue.js';

function scriptedDb(handlers: Array<{
  match: string;
  rows?: unknown[];
  onQuery?: (sql: string, params?: unknown[]) => void;
}>): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const handler = handlers.find((h) => sql.includes(h.match));
      handler?.onQuery?.(sql, params);
      return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows?.length ?? 0 };
    },
  } as Queryable;
}

describe('requeueArticleForFilter', () => {
  it('wipes cheap-filter columns and clears ignore reason when status is IGNORED', async () => {
    let updateSql = '';
    let updateParams: unknown[] = [];
    const db = scriptedDb([
      {
        match: 'UPDATE articles',
        rows: [{ id: '42', processing_status: 'NEW' }],
        onQuery: (sql, params) => {
          updateSql = sql;
          updateParams = params ?? [];
        },
      },
    ]);

    const result = await requeueArticleForFilter(db, '42');

    expect(result).toEqual({ articleId: '42', processingStatus: 'NEW' });
    expect(updateSql).toContain('processing_status');
    expect(updateSql).toContain('processing_error = NULL');
    expect(updateSql).toContain('cheap_filter_decision = NULL');
    expect(updateSql).toContain('cheap_filter_score = NULL');
    expect(updateSql).toContain("cheap_filter_reasons = '{}'");
    expect(updateSql).toContain("cheap_filter_blocking_reasons = '{}'");
    expect(updateSql).toContain("cheap_filter_matched_signals = '{}'::jsonb");
    expect(updateSql).toMatch(/WHERE\s+id\s*=\s*\$1\s+AND\s+processing_status\s*=\s*'IGNORED'/);
    expect(updateParams).toEqual(['42']);
  });

  it('rejects when the article is in any status other than IGNORED', async () => {
    const db = scriptedDb([
      {
        match: 'UPDATE articles',
        rows: [],
      },
    ]);

    await expect(requeueArticleForFilter(db, '99')).rejects.toBeInstanceOf(
      ArticleNotIgnorableError
    );
    await expect(requeueArticleForFilter(db, '99')).rejects.toThrow(/not in IGNORED/i);
  });

  it('rejects when the article does not exist', async () => {
    const db = scriptedDb([
      {
        match: 'UPDATE articles',
        rows: [],
      },
    ]);

    await expect(requeueArticleForFilter(db, '404')).rejects.toBeInstanceOf(
      ArticleNotIgnorableError
    );
  });
});