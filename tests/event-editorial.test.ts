import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import {
  approveEvent,
  listWorkspaceEvents,
  unpublishEvent,
  updateEventFields,
} from '../src/events/event-editorial.js';

function scriptedDb(handlers: Array<{ match: string; rows: unknown[]; onQuery?: (sql: string, params?: unknown[]) => void }>): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const handler = handlers.find((h) => sql.includes(h.match));
      handler?.onQuery?.(sql, params);
      return { rows: (handler?.rows ?? []) as T[], rowCount: handler?.rows.length ?? 0 };
    },
  } as Queryable;
}

const baseRow = {
  id: '10',
  grouping_key: null,
  first_seen_at: new Date('2026-07-13T00:00:00Z'),
  event_title: 'CyberArk PAS exploited',
  event_summary: 'Active exploitation reported.',
  event_status: 'open',
  publication_status: 'draft',
  severity: 'high',
  urgency: 'P1',
  confidence: '0.8',
  affected_vendors: ['CyberArk'],
  affected_products: ['PAS'],
  cves: ['CVE-2026-1'],
  attack_types: ['exploitation'],
  summary_stale: false,
  source_count: 2,
  last_seen_at: new Date('2026-07-13T12:00:00Z'),
};

describe('event editorial', () => {
  it('approves a draft event by setting publication_status to approved', async () => {
    let updateSql = '';
    let updateParams: unknown[] = [];
    const db = scriptedDb([
      {
        match: 'SELECT id, grouping_key',
        rows: [baseRow],
      },
      {
        match: 'UPDATE cyber_events',
        rows: [{ ...baseRow, publication_status: 'approved' }],
        onQuery: (sql, params) => {
          updateSql = sql;
          updateParams = params ?? [];
        },
      },
    ]);

    const event = await approveEvent(db, '10');

    expect(updateSql).toContain('publication_status');
    expect(updateParams).toContain('approved');
    expect(updateParams).toContain('10');
    expect(event.publicationStatus).toBe('approved');
  });

  it('rejects approve when the event has no vendor or product', async () => {
    const db = scriptedDb([
      {
        match: 'SELECT id, grouping_key',
        rows: [{ ...baseRow, affected_vendors: [], affected_products: [] }],
      },
    ]);

    await expect(approveEvent(db, '10')).rejects.toThrow(/vendor or product/i);
  });

  it('unpublishes an approved event back to draft', async () => {
    let updateSql = '';
    let updateParams: unknown[] = [];
    const db = scriptedDb([
      {
        match: 'UPDATE cyber_events',
        rows: [{ ...baseRow, publication_status: 'draft' }],
        onQuery: (sql, params) => {
          updateSql = sql;
          updateParams = params ?? [];
        },
      },
    ]);

    const event = await unpublishEvent(db, '10');

    expect(updateSql).toContain('publication_status');
    expect(updateParams).toContain('draft');
    expect(event.publicationStatus).toBe('draft');
  });

  it('updates editable event fields without changing publication status', async () => {
    let updateSql = '';
    let updateParams: unknown[] = [];
    const db = scriptedDb([
      {
        match: 'UPDATE cyber_events',
        rows: [
          {
            ...baseRow,
            event_title: 'Updated title',
            event_summary: 'Updated summary',
            severity: 'critical',
            urgency: 'P0',
            affected_vendors: ['CyberArk', 'Microsoft'],
            affected_products: ['PAS'],
            cves: ['CVE-2026-1', 'CVE-2026-2'],
            attack_types: ['ransomware'],
          },
        ],
        onQuery: (sql, params) => {
          updateSql = sql;
          updateParams = params ?? [];
        },
      },
    ]);

    const event = await updateEventFields(db, '10', {
      eventTitle: 'Updated title',
      eventSummary: 'Updated summary',
      severity: 'critical',
      urgency: 'P0',
      affectedVendors: ['CyberArk', 'Microsoft'],
      affectedProducts: ['PAS'],
      cves: ['CVE-2026-1', 'CVE-2026-2'],
      attackTypes: ['ransomware'],
    });

    expect(updateSql).toContain('event_title');
    expect(updateSql).toContain('event_summary');
    expect(updateSql).toContain('severity');
    expect(updateSql).toContain('urgency');
    expect(updateSql).toContain('affected_vendors');
    expect(updateSql).toContain('affected_products');
    expect(updateSql).toContain('cves');
    expect(updateSql).toContain('attack_types');
    expect(updateSql).not.toMatch(/publication_status\s*=/);
    expect(updateParams[0]).toBe('10');
    expect(event.eventTitle).toBe('Updated title');
    expect(event.severity).toBe('critical');
    expect(event.publicationStatus).toBe('draft');
  });

  it('lists draft and approved events for the workspace', async () => {
    let listSql = '';
    const db = scriptedDb([
      {
        match: 'FROM cyber_events',
        rows: [
          { ...baseRow, id: '1', publication_status: 'draft' },
          { ...baseRow, id: '2', publication_status: 'approved', event_title: 'Approved one' },
        ],
        onQuery: (sql) => {
          listSql = sql;
        },
      },
    ]);

    const items = await listWorkspaceEvents(db, { limit: 50 });

    expect(listSql).not.toContain("publication_status = 'approved'");
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.publicationStatus).sort()).toEqual(['approved', 'draft']);
  });
});
