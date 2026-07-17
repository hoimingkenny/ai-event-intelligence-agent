import { describe, expect, it } from 'vitest';
import type { QueryResult } from 'pg';
import type { Queryable } from '../src/db/repositories/types.js';
import { loadDigestEvalReportForRun } from '../src/evaluation/digest/digest-eval-report-load.js';

interface ScriptedHandler {
  match: string;
  rows: unknown[];
  repeat?: boolean;
}

function makeScriptedDb(handlers: ScriptedHandler[]): Queryable {
  const queue = handlers.slice();
  return {
    async query<T>(sql: string) {
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

describe('loadDigestEvalReportForRun', () => {
  it('rebuilds metrics from gold and stored predictions', async () => {
    const db = makeScriptedDb([
      {
        match: 'FROM digest_eval_runs\n        WHERE id',
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
            finished_at: new Date(),
            total_predictions_saved: 1,
            total_predictions_failed: 0,
          },
        ],
      },
      {
        match: 'FROM digest_gold_labels',
        rows: [
          {
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
            inventory_snapshot: [],
            labeled_by: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      },
      {
        match: 'FROM digest_eval_predictions',
        rows: [
          {
            id: 'pred-1',
            run_id: 'run-1',
            article_id: '42',
            prediction_json: {
              relatedToMonitoredInventory: true,
              matchedVendors: ['CyberArk'],
              matchedProducts: ['PAS'],
              cves: ['CVE-2024-10001'],
            },
            error_message: null,
            created_at: new Date(),
          },
        ],
      },
    ]);

    const loaded = await loadDigestEvalReportForRun(db, 'run-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.report.metrics.relatednessF1).toBe(1);
    expect(loaded?.report.results[0].failures).toHaveLength(0);
  });
});
