import { describe, expect, it, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';
import type { Queryable } from '../src/db/repositories/types.js';
import {
  upsertDigestGold,
} from '../src/workspace/workspace-digest-gold-writes.js';

interface ScriptedHandler {
  match: string;
  rows: unknown[];
  onQuery?: (sql: string, params?: unknown[]) => void;
  repeat?: boolean;
}

interface ScriptedDb extends Queryable {
  queries: { sql: string; params?: unknown[] }[];
}

function makeScriptedDb(handlers: ScriptedHandler[]): ScriptedDb {
  const queue = handlers.slice();
  const db = {
    queries: [] as { sql: string; params?: unknown[] }[],
    async query<T>(sql: string, params?: unknown[]) {
      db.queries.push({ sql, params });
      const idx = queue.findIndex((h) => sql.includes(h.match));
      if (idx === -1) {
        return { rows: [] as T[], rowCount: 0 } as QueryResult<T>;
      }
      const handler = queue[idx];
      handler.onQuery?.(sql, params);
      if (!handler.repeat) queue.splice(idx, 1);
      return {
        rows: handler.rows as T[],
        rowCount: handler.rows.length,
      } as QueryResult<T>;
    },
  };
  return db as unknown as ScriptedDb;
}

const INVENTORY_ROWS = [
  {
    vendor: 'CyberArk',
    product: 'PAS',
    criticality: 'critical',
    news_volume: 'quiet',
    is_active: true,
    aliases: ['Privileged Access Security'],
  },
];

const ARTICLE_ROW = {
  id: '42',
  processing_status: 'DIGESTED',
  title: 'CyberArk advisory',
  source_name: 'CyberArk Blog',
  rss_summary: 'Summary',
  clean_text: 'Body text about PAS CVE-2024-1234',
  llm_article_digest: {
    relatedToMonitoredInventory: true,
    incidentSummary: 'Advisory',
    cves: ['CVE-2024-1234'],
    matchedVendors: ['CyberArk'],
    matchedProducts: ['PAS'],
    mentionedVendors: [],
    mentionedProducts: [],
    affectedOrganizations: [],
    confidence: 0.9,
    reasoning: 'test',
  },
};

describe('upsertDigestGold', () => {
  let db: ScriptedDb;

  beforeEach(() => {
    db = makeScriptedDb([]);
  });

  it('rejects missing articles', async () => {
    db = makeScriptedDb([{ match: 'FROM articles', rows: [] }]);
    await expect(
      upsertDigestGold(
        {
          articleId: '42',
          relatedToMonitoredInventory: false,
          matchedVendors: [],
          matchedProducts: [],
          cves: [],
          humanReason: null,
        },
        db
      )
    ).rejects.toMatchObject({ code: 'article_not_found' });
  });

  it('rejects articles without digest eligibility', async () => {
    db = makeScriptedDb([
      {
        match: 'FROM articles',
        rows: [{ ...ARTICLE_ROW, processing_status: 'NEW', llm_article_digest: null }],
      },
    ]);
    await expect(
      upsertDigestGold(
        {
          articleId: '42',
          relatedToMonitoredInventory: false,
          matchedVendors: [],
          matchedProducts: [],
          cves: [],
          humanReason: null,
        },
        db
      )
    ).rejects.toMatchObject({ code: 'article_not_eligible' });
  });

  it('clears inventory matches when unrelated', async () => {
    db = makeScriptedDb([
      { match: 'FROM articles', rows: [ARTICLE_ROW] },
      { match: 'FROM vendor_products', rows: INVENTORY_ROWS },
      { match: 'INSERT INTO digest_gold_labels', rows: [{ id: 'gold-1' }], onQuery: (_sql, params) => {
          expect(params?.[1]).toBe(false);
          expect(params?.[2]).toEqual([]);
          expect(params?.[3]).toEqual([]);
        } },
    ]);

    await upsertDigestGold(
      {
        articleId: '42',
        relatedToMonitoredInventory: false,
        matchedVendors: ['CyberArk'],
        matchedProducts: ['PAS'],
        cves: ['cve-2024-1234'],
        humanReason: ' commentary only ',
      },
      db
    );

    const insert = db.queries.find((q) => q.sql.includes('INSERT INTO digest_gold_labels'));
    expect(insert?.params?.[4]).toEqual(['CVE-2024-1234']);
    expect(insert?.params?.[5]).toBe('commentary only');
    expect(insert?.params?.[6]).toContain('CyberArk advisory');
  });

  it('requires at least one inventory match when related', async () => {
    db = makeScriptedDb([
      { match: 'FROM articles', rows: [ARTICLE_ROW] },
      { match: 'FROM vendor_products', rows: INVENTORY_ROWS },
    ]);

    await expect(
      upsertDigestGold(
        {
          articleId: '42',
          relatedToMonitoredInventory: true,
          matchedVendors: [],
          matchedProducts: [],
          cves: [],
          humanReason: null,
        },
        db
      )
    ).rejects.toMatchObject({ code: 'related_requires_inventory_match' });
  });

  it('rejects unknown vendors when related', async () => {
    db = makeScriptedDb([
      { match: 'FROM articles', rows: [ARTICLE_ROW], repeat: true },
      { match: 'FROM vendor_products', rows: INVENTORY_ROWS, repeat: true },
    ]);

    await expect(
      upsertDigestGold(
        {
          articleId: '42',
          relatedToMonitoredInventory: true,
          matchedVendors: ['Unknown Vendor'],
          matchedProducts: [],
          cves: [],
          humanReason: null,
        },
        db
      )
    ).rejects.toMatchObject({ code: 'invalid_inventory_vendor' });
  });

  it('canonicalizes related gold and freezes snapshots', async () => {
    db = makeScriptedDb([
      { match: 'FROM articles', rows: [ARTICLE_ROW] },
      { match: 'FROM vendor_products', rows: INVENTORY_ROWS },
      { match: 'INSERT INTO digest_gold_labels', rows: [{ id: 'gold-1' }] },
    ]);

    await upsertDigestGold(
      {
        articleId: '42',
        relatedToMonitoredInventory: true,
        matchedVendors: ['cyberark'],
        matchedProducts: ['pas'],
        cves: ['CVE-2024-1234'],
        humanReason: 'confirmed',
        labeledBy: 'analyst',
      },
      db
    );

    const insert = db.queries.find((q) => q.sql.includes('INSERT INTO digest_gold_labels'));
    expect(insert?.params?.[2]).toEqual(['CyberArk']);
    expect(insert?.params?.[3]).toEqual(['PAS']);
    const snapshot = JSON.parse(String(insert?.params?.[6]));
    expect(snapshot.title).toBe('CyberArk advisory');
    const inventory = JSON.parse(String(insert?.params?.[7]));
    expect(inventory[0]?.vendor).toBe('CyberArk');
    expect(insert?.params?.[8]).toBe('analyst');
  });
});
