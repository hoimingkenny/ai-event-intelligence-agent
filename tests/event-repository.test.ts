import { describe, expect, it } from 'vitest';
import { EventRepository } from '../src/db/repositories/event.repository.js';
import type { Queryable } from '../src/db/repositories/types.js';

describe('EventRepository', () => {
  it('marks summaries stale only when attaching a material update relationship', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const db = {
      async query<T>(sql: string, params?: unknown[]) {
        calls.push({ sql, params });
        return { rows: [] as T[], rowCount: 0 };
      },
    } as Queryable;

    await new EventRepository(db).attachArticle({
      eventId: '10',
      articleId: '20',
      relationship: 'same_event_material_update',
      confidence: 0.8,
      isMaterialUpdate: true,
    });

    const update = calls.find((call) => call.sql.includes('summary_stale = CASE'));
    expect(update?.params).toEqual(['10', 'same_event_material_update']);
  });
});
