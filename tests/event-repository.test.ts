import { describe, expect, it } from 'vitest';
import { EventRepository } from '../src/db/repositories/event.repository.js';
import type { Queryable } from '../src/db/repositories/types.js';

describe('EventRepository', () => {
  it('creates canonical events as draft publication status', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const db = {
      async query<T>(sql: string, params?: unknown[]) {
        calls.push({ sql, params });
        return {
          rows: [
            {
              id: '1',
              grouping_key: null,
              first_seen_at: new Date('2026-07-13T00:00:00Z'),
              event_title: 'Test event',
              event_summary: null,
              event_status: 'open',
              publication_status: 'draft',
              severity: null,
              urgency: null,
              confidence: null,
              affected_vendors: [],
              affected_products: [],
              cves: [],
              attack_types: [],
              summary_stale: false,
            },
          ] as T[],
          rowCount: 1,
        };
      },
    } as Queryable;

    const created = await new EventRepository(db).createEvent({ eventTitle: 'Test event' });

    const insert = calls.find((call) => call.sql.includes('INSERT INTO cyber_events'));
    expect(insert?.sql).toContain('publication_status');
    expect(insert?.params).toContain('draft');
    expect(created.publicationStatus).toBe('draft');
  });

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

  it('lists alert candidates without filtering on publication status', async () => {
    let listSql = '';
    const db = {
      async query<T>(sql: string) {
        listSql = sql;
        return { rows: [] as T[], rowCount: 0 };
      },
    } as Queryable;

    await new EventRepository(db).listAlertCandidates(10);

    expect(listSql).toContain("event_status = 'open'");
    expect(listSql).not.toMatch(/publication_status\s*=/);
  });
});
