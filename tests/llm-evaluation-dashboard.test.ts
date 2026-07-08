import { describe, expect, it } from 'vitest';
import type { Queryable } from '../src/db/repositories/types.js';
import { loadLlmEvaluationDashboard } from '../src/review/llm-evaluation-dashboard.js';

describe('LLM evaluation dashboard', () => {
  it('loads latest judge runs and summarizes selected run findings', async () => {
    const db = {
      query: async (sql: string) => {
        if (sql.includes('FROM cheap_filter_llm_eval_runs')) {
          return {
            rows: [
              {
                id: 'run-1',
                model_name: 'MiniMax-M3',
                prompt_version: 'cheap-filter-llm-eval-v1',
                started_at: new Date('2026-07-07T10:00:00Z'),
                finished_at: new Date('2026-07-07T10:02:00Z'),
                total_articles_sampled: 2,
                total_evaluations_saved: 2,
                total_evaluations_failed: 0,
                notes: null,
              },
            ],
          };
        }

        if (sql.includes('FROM cheap_filter_llm_evaluations')) {
          return {
            rows: [
              {
                id: 'eval-1',
                article_id: '101',
                article_title: 'Critical SharePoint zero-day exploited',
                article_url: 'https://example.test/sharepoint',
                source_name: 'Security News',
                published_at: new Date('2026-07-07T09:00:00Z'),
                cheap_filter_decision: 'DROP',
                cheap_filter_score: '10',
                llm_label: 'CRITICAL_RELEVANT',
                expected_decision: 'KEEP',
                score_assessment: 'TOO_LOW',
                recommended_score_band: '80-100',
                is_actionable_for_impact_review: true,
                relevance_type: 'active_exploitation',
                scoring_issue: 'missing_keyword',
                explanation: 'The metadata describes active exploitation.',
                suggested_rule_changes: ['Raise exploitation language.'],
                suggested_keywords_to_add: ['actively exploited'],
                suggested_vendor_product_aliases_to_add: [],
                created_at: new Date('2026-07-07T10:01:00Z'),
              },
              {
                id: 'eval-2',
                article_id: '102',
                article_title: 'Cloudflare product launch',
                article_url: null,
                source_name: 'Business Wire',
                published_at: new Date('2026-07-07T08:00:00Z'),
                cheap_filter_decision: 'KEEP',
                cheap_filter_score: '80',
                llm_label: 'IRRELEVANT',
                expected_decision: 'DROP',
                score_assessment: 'TOO_HIGH',
                recommended_score_band: '0-14',
                is_actionable_for_impact_review: false,
                relevance_type: 'business_noise',
                scoring_issue: 'product_score_too_high',
                explanation: 'The metadata is a product announcement.',
                suggested_rule_changes: [],
                suggested_keywords_to_add: [],
                suggested_vendor_product_aliases_to_add: [],
                created_at: new Date('2026-07-07T10:01:30Z'),
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    } as unknown as Queryable;

    const dashboard = await loadLlmEvaluationDashboard(db);

    expect(dashboard.available).toBe(true);
    expect(dashboard.runs).toHaveLength(1);
    expect(dashboard.selectedRun?.metrics.totalEvaluated).toBe(2);
    expect(dashboard.selectedRun?.metrics.falseNegativeRisks).toBe(1);
    expect(dashboard.selectedRun?.metrics.falsePositiveRisks).toBe(1);
    expect(dashboard.selectedRun?.metrics.actionableForImpactReview).toBe(1);
    expect(dashboard.selectedRun?.issueCounts).toContainEqual({ key: 'missing_keyword', count: 1 });
    expect(dashboard.selectedRun?.relevanceCounts).toContainEqual({ key: 'business_noise', count: 1 });
  });

  it('returns a setup message when LLM evaluation tables are missing', async () => {
    const db = {
      query: async () => {
        const error = new Error('relation does not exist') as Error & { code: string };
        error.code = '42P01';
        throw error;
      },
    } as unknown as Queryable;

    const dashboard = await loadLlmEvaluationDashboard(db);

    expect(dashboard.available).toBe(false);
    expect(dashboard.message).toContain('npm run db:migrate');
    expect(dashboard.runs).toEqual([]);
  });
});
