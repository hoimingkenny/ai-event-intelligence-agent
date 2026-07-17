import { describe, expect, it } from 'vitest';
import type { QueryResult } from 'pg';
import type { Queryable } from '../src/db/repositories/types.js';
import {
  parseStoredDigest,
  predictionFieldsFromDigest,
  runDigestEval,
} from '../src/evaluation/digest/digest-eval-runner.js';
import type { ArticleDigest } from '../src/llm/schemas.js';

interface ScriptedHandler {
  match: string;
  rows: unknown[];
  repeat?: boolean;
}

function makeScriptedDb(handlers: ScriptedHandler[]): Queryable {
  const queue = handlers.slice();
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const idx = queue.findIndex((h) => sql.includes(h.match));
      if (idx === -1) {
        return { rows: [] as T[], rowCount: 0 } as QueryResult<T>;
      }
      const handler = queue[idx];
      if (!handler.repeat) queue.splice(idx, 1);
      return {
        rows: handler.rows as T[],
        rowCount: handler.rows.length,
      } as QueryResult<T>;
    },
  };
}

const GOLD_ROW = {
  id: 'gold-1',
  article_id: '42',
  related_to_monitored_inventory: true,
  matched_vendors: ['CyberArk'],
  matched_products: ['PAS'],
  cves: ['CVE-2024-10001'],
  human_reason: null,
  article_snapshot: {
    title: 'Advisory',
    sourceName: 'Blog',
    rssSummary: 'rss',
    cleanText: 'body',
  },
  inventory_snapshot: [
    {
      id: 'vp_cyberark_pas',
      vendor: 'CyberArk',
      product: 'PAS',
      criticality: 'critical',
      inProduction: true,
      newsVolume: 'quiet',
      aliases: [],
    },
  ],
  labeled_by: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const STORED_DIGEST: ArticleDigest = {
  relatedToMonitoredInventory: true,
  incidentSummary: 'Advisory',
  cves: ['CVE-2024-10001'],
  matchedVendors: ['CyberArk'],
  matchedProducts: ['PAS'],
  mentionedVendors: [],
  mentionedProducts: [],
  affectedOrganizations: [],
  confidence: 0.9,
  reasoning: 'test',
};

describe('parseStoredDigest', () => {
  it('normalizes stored digest against frozen inventory', () => {
    const fields = parseStoredDigest(
      { ...STORED_DIGEST, matchedVendors: ['cyberark'], matchedProducts: ['pas'] },
      GOLD_ROW.inventory_snapshot
    );
    expect(fields?.matchedVendors).toEqual(['CyberArk']);
    expect(fields?.matchedProducts).toEqual(['PAS']);
  });
});

describe('runDigestEval baseline', () => {
  it('scores stored digests without calling digest stage', async () => {
    const db = makeScriptedDb([
      { match: 'FROM digest_gold_labels', rows: [GOLD_ROW] },
      {
        match: 'INSERT INTO digest_eval_runs',
        rows: [
          {
            id: 'run-1',
            mode: 'baseline',
            prompt_version: 'stored',
            model_name: null,
            gold_count: 1,
            cli_args: {},
            comparison_baseline_run_id: null,
            started_at: new Date(),
            finished_at: null,
            total_predictions_saved: 0,
            total_predictions_failed: 0,
          },
        ],
      },
      { match: 'SELECT llm_article_digest FROM articles', rows: [{ llm_article_digest: STORED_DIGEST }] },
      { match: 'INSERT INTO digest_eval_predictions', rows: [], repeat: true },
      { match: 'UPDATE digest_eval_runs', rows: [] },
    ]);

    const digestFn = async () => {
      throw new Error('regen digest should not run in baseline mode');
    };

    const { report } = await runDigestEval(db, {
      mode: 'baseline',
      outDir: '/tmp/digest-eval-test',
      formats: ['json'],
      digestFn,
    });

    expect(report.metrics.goldCount).toBe(1);
    expect(report.metrics.relatednessF1).toBe(1);
    expect(report.results[0].failures).toHaveLength(0);
  });

  it('regen uses injectable digest function on frozen snapshots', async () => {
    const db = makeScriptedDb([
      { match: 'FROM digest_gold_labels', rows: [GOLD_ROW] },
      { match: 'FROM digest_eval_runs', rows: [] },
      {
        match: 'INSERT INTO digest_eval_runs',
        rows: [
          {
            id: 'run-2',
            mode: 'regen',
            prompt_version: 'article-digest-v2',
            model_name: 'test-model',
            gold_count: 1,
            cli_args: {},
            comparison_baseline_run_id: null,
            started_at: new Date(),
            finished_at: null,
            total_predictions_saved: 0,
            total_predictions_failed: 0,
          },
        ],
      },
      { match: 'INSERT INTO digest_eval_predictions', rows: [], repeat: true },
      { match: 'UPDATE digest_eval_runs', rows: [] },
    ]);

    const { report } = await runDigestEval(db, {
      mode: 'regen',
      outDir: '/tmp/digest-eval-test',
      formats: ['json'],
      digestFn: async () => STORED_DIGEST,
    });

    expect(report.mode).toBe('regen');
    expect(predictionFieldsFromDigest(STORED_DIGEST).matchedProducts).toEqual(['PAS']);
  });
});
