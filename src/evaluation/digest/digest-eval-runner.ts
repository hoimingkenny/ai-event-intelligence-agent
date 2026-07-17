import type { ArticleRecord } from '../../db/repositories/article.repository.js';
import { DigestGoldRepository } from '../../db/repositories/digest-gold.repository.js';
import type { Queryable } from '../../db/repositories/types.js';
import {
  ARTICLE_DIGEST_PROMPT_VERSION,
  digestArticleAgainstInventory,
  normalizeArticleDigest,
} from '../../llm/article-digest.js';
import { ArticleDigestSchema, type ArticleDigest } from '../../llm/schemas.js';
import type { DigestGoldLabelRecord } from './digest-gold-types.js';
import { evaluateDigestEvalSamples } from '../../../eval/utils/digest-metrics.js';
import { writeDigestEvalReports, type DigestReportFormat } from '../../../eval/utils/digest-report-writers.js';
import type {
  DigestEvalPredictionFields,
  DigestEvalReport,
  DigestEvalScoredSample,
} from '../../../eval/types/digest-eval.types.js';
import { model as defaultModel } from '../../config/llm.js';
import { DigestEvalRepository } from './digest-eval-repository.js';
import { runWithConcurrency } from '../../utils/concurrency.js';
import { env } from '../../config/env.js';

export const BASELINE_PROMPT_VERSION = 'stored';

export interface RunDigestEvalOptions {
  mode: 'baseline' | 'regen';
  outDir: string;
  formats: DigestReportFormat[];
  concurrency?: number;
  dryRun?: boolean;
  modelName?: string;
  digestFn?: typeof digestArticleAgainstInventory;
}

export interface RunDigestEvalResult {
  report: DigestEvalReport;
  runId: string;
}

export function predictionFieldsFromDigest(digest: ArticleDigest): DigestEvalPredictionFields {
  return {
    relatedToMonitoredInventory: digest.relatedToMonitoredInventory,
    matchedVendors: digest.matchedVendors,
    matchedProducts: digest.matchedProducts,
    cves: digest.cves,
  };
}

export function articleRecordFromGold(gold: DigestGoldLabelRecord): ArticleRecord {
  return {
    id: gold.articleId,
    feedId: null,
    sourceName: gold.articleSnapshot.sourceName,
    title: gold.articleSnapshot.title,
    canonicalUrl: null,
    urlHash: null,
    titleHash: null,
    contentHash: null,
    rssSummary: gold.articleSnapshot.rssSummary,
    cleanText: gold.articleSnapshot.cleanText,
    publishedAt: null,
    extractionStatus: 'done',
    extractionMethod: 'eval_snapshot',
    extractionError: null,
    processingStatus: 'DIGESTED',
  };
}

export function parseStoredDigest(
  raw: unknown,
  inventory: DigestGoldLabelRecord['inventorySnapshot']
): DigestEvalPredictionFields | null {
  const parsed = ArticleDigestSchema.safeParse(raw);
  if (!parsed.success) return null;
  const normalized = normalizeArticleDigest(parsed.data, inventory);
  return predictionFieldsFromDigest(normalized);
}

export async function runDigestEval(
  db: Queryable,
  options: RunDigestEvalOptions
): Promise<RunDigestEvalResult> {
  const goldRepo = new DigestGoldRepository(db);
  const evalRepo = new DigestEvalRepository(db);
  const goldRows = await goldRepo.listAllForEval();

  if (goldRows.length === 0) {
    throw new Error('No digest gold labels found. Label articles in Workspace first.');
  }

  const baselineRun =
    options.mode === 'regen' ? await evalRepo.findLatestRun('baseline') : null;

  const run = await evalRepo.createRun({
    mode: options.mode,
    promptVersion:
      options.mode === 'baseline' ? BASELINE_PROMPT_VERSION : ARTICLE_DIGEST_PROMPT_VERSION,
    modelName: options.mode === 'regen' ? (options.modelName ?? defaultModel) : null,
    goldCount: goldRows.length,
    cliArgs: {
      outDir: options.outDir,
      formats: options.formats,
      dryRun: options.dryRun ?? false,
    },
    comparisonBaselineRunId: baselineRun?.id ?? null,
  });

  let saved = 0;
  let failed = 0;
  const scoredSamples: DigestEvalScoredSample[] = [];

  const work = async (gold: DigestGoldLabelRecord) => {
    let prediction: DigestEvalPredictionFields | null = null;
    let errorMessage: string | null = null;

    try {
      if (options.mode === 'baseline') {
        const articleResult = await db.query<{ llm_article_digest: unknown }>(
          `SELECT llm_article_digest FROM articles WHERE id = $1`,
          [gold.articleId]
        );
        const raw = articleResult.rows[0]?.llm_article_digest;
        if (raw == null) {
          throw new Error('No stored llm_article_digest on article.');
        }
        prediction = parseStoredDigest(raw, gold.inventorySnapshot);
        if (!prediction) {
          throw new Error('Stored digest failed schema validation.');
        }
      } else if (options.dryRun) {
        throw new Error('Dry run: skipped LLM regen call.');
      } else {
        if (!env.minimaxApiKey) {
          throw new Error('MINIMAX_API_KEY is required for regen eval.');
        }
        const digestFn = options.digestFn ?? digestArticleAgainstInventory;
        const digest = await digestFn(
          articleRecordFromGold(gold),
          gold.inventorySnapshot
        );
        prediction = predictionFieldsFromDigest(digest);
      }

      await evalRepo.savePrediction({
        runId: run.id,
        articleId: gold.articleId,
        prediction,
      });
      saved += 1;
      scoredSamples.push({
        articleId: gold.articleId,
        gold: {
          relatedToMonitoredInventory: gold.relatedToMonitoredInventory,
          matchedVendors: gold.matchedVendors,
          matchedProducts: gold.matchedProducts,
          cves: gold.cves,
          humanReason: gold.humanReason,
        },
        prediction,
      });
    } catch (error) {
      failed += 1;
      errorMessage = error instanceof Error ? error.message : String(error);
      await evalRepo.savePrediction({
        runId: run.id,
        articleId: gold.articleId,
        prediction: null,
        errorMessage,
      });
      scoredSamples.push({
        articleId: gold.articleId,
        gold: {
          relatedToMonitoredInventory: gold.relatedToMonitoredInventory,
          matchedVendors: gold.matchedVendors,
          matchedProducts: gold.matchedProducts,
          cves: gold.cves,
          humanReason: gold.humanReason,
        },
        prediction: {
          relatedToMonitoredInventory: false,
          matchedVendors: [],
          matchedProducts: [],
          cves: [],
        },
      });
    }
  };

  const concurrency = options.concurrency ?? env.llmConcurrency;
  await runWithConcurrency(goldRows, concurrency, work);

  await evalRepo.completeRun(run.id, { saved, failed });

  let comparisonBaselineMetrics = null;
  if (baselineRun) {
    const baselinePredictions = await loadScoredSamplesFromRun(db, baselineRun.id, goldRows);
    if (baselinePredictions.length > 0) {
      comparisonBaselineMetrics = evaluateDigestEvalSamples(baselinePredictions).metrics;
    }
  }

  const report = evaluateDigestEvalSamples(scoredSamples, {
    mode: options.mode,
    runId: run.id,
    promptVersion: run.promptVersion,
    modelName: run.modelName,
    comparisonBaselineRunId: baselineRun?.id ?? null,
    comparisonBaselineMetrics,
  });

  await writeDigestEvalReports(report, options.outDir, options.formats, {
    filenamePrefix: `digest-eval-${options.mode}-${run.id.slice(0, 8)}`,
  });

  return { report, runId: run.id };
}

async function loadScoredSamplesFromRun(
  db: Queryable,
  runId: string,
  goldRows: DigestGoldLabelRecord[]
): Promise<DigestEvalScoredSample[]> {
  const evalRepo = new DigestEvalRepository(db);
  const predictions = await evalRepo.listPredictionsForRun(runId);
  const goldByArticle = new Map(goldRows.map((row) => [row.articleId, row]));

  return predictions
    .filter((row) => row.prediction != null)
    .map((row) => {
      const gold = goldByArticle.get(row.articleId);
      if (!gold || !row.prediction) return null;
      return {
        articleId: row.articleId,
        gold: {
          relatedToMonitoredInventory: gold.relatedToMonitoredInventory,
          matchedVendors: gold.matchedVendors,
          matchedProducts: gold.matchedProducts,
          cves: gold.cves,
          humanReason: gold.humanReason,
        },
        prediction: row.prediction,
      };
    })
    .filter((sample): sample is DigestEvalScoredSample => sample !== null);
}
