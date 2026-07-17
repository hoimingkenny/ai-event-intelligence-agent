import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDatabasePool } from '../src/db/pool.js';
import { model as defaultModel } from '../src/config/llm.js';
import { env } from '../src/config/env.js';
import {
  CHEAP_FILTER_LLM_EVAL_PROMPT_VERSION,
  LlmEvalParseFailure,
  aggregateLlmEvaluations,
  generateCheapFilterLlmEvalReport,
  runCheapFilterLlmEval,
  sampleCheapFilterEvalArticles,
  LlmEvalRepository,
  type CheapFilterEvalInput,
  type SourceTier,
} from '../src/evaluation/cheap-filter/index.js';
import { runWithConcurrency } from '../src/utils/concurrency.js';

interface CliOptions {
  sampleSize: number;
  sinceDays: number;
  sourceTier?: SourceTier;
  decision?: 'KEEP' | 'MAYBE_KEEP' | 'DROP';
  concurrency: number;
  randomSample: boolean;
  dryRun: boolean;
  modelName?: string;
  output?: string;
  notes?: string;
}

const VALID_SOURCE_TIERS: SourceTier[] = [
  'official_vendor',
  'government_cert',
  'security_media',
  'researcher_blog',
  'general_news',
  'unknown',
];

const VALID_DECISIONS = ['KEEP', 'MAYBE_KEEP', 'DROP'] as const;

function readOption(args: string[], name: string): string | undefined {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function parseArgs(argv: string[]): CliOptions {
  const sampleSizeRaw = readOption(argv, '--sample-size');
  const sinceDaysRaw = readOption(argv, '--since-days');
  const sourceTierRaw = readOption(argv, '--source-tier');
  const decisionRaw = readOption(argv, '--decision');
  const concurrencyRaw = readOption(argv, '--concurrency');
  const modelRaw = readOption(argv, '--model');
  const outputRaw = readOption(argv, '--output');
  const notesRaw = readOption(argv, '--notes');

  const sampleSize = sampleSizeRaw ? Number(sampleSizeRaw) : 200;
  const sinceDays = sinceDaysRaw ? Number(sinceDaysRaw) : 30;
  const concurrency = concurrencyRaw ? Number(concurrencyRaw) : env.llmConcurrency ?? 5;

  if (!Number.isFinite(sampleSize) || sampleSize <= 0) {
    throw new Error(`--sample-size must be a positive integer (got ${sampleSizeRaw})`);
  }
  if (!Number.isFinite(sinceDays) || sinceDays <= 0) {
    throw new Error(`--since-days must be a positive integer (got ${sinceDaysRaw})`);
  }
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error(`--concurrency must be a positive integer (got ${concurrencyRaw})`);
  }

  let sourceTier: SourceTier | undefined;
  if (sourceTierRaw) {
    if (!VALID_SOURCE_TIERS.includes(sourceTierRaw as SourceTier)) {
      throw new Error(`--source-tier must be one of: ${VALID_SOURCE_TIERS.join(', ')}`);
    }
    sourceTier = sourceTierRaw as SourceTier;
  }

  let decision: 'KEEP' | 'MAYBE_KEEP' | 'DROP' | undefined;
  if (decisionRaw) {
    if (!(VALID_DECISIONS as readonly string[]).includes(decisionRaw)) {
      throw new Error(`--decision must be one of: ${VALID_DECISIONS.join(', ')}`);
    }
    decision = decisionRaw as 'KEEP' | 'MAYBE_KEEP' | 'DROP';
  }

  return {
    sampleSize,
    sinceDays,
    sourceTier,
    decision,
    concurrency,
    randomSample: argv.includes('--random-sample'),
    dryRun: argv.includes('--dry-run'),
    modelName: modelRaw,
    output: outputRaw,
    notes: notesRaw,
  };
}

function toCliArgsRecord(options: CliOptions): Record<string, unknown> {
  return {
    sampleSize: options.sampleSize,
    sinceDays: options.sinceDays,
    sourceTier: options.sourceTier ?? null,
    decision: options.decision ?? null,
    concurrency: options.concurrency,
    randomSample: options.randomSample,
    dryRun: options.dryRun,
    modelName: options.modelName ?? null,
    output: options.output ?? null,
    notes: options.notes ?? null,
  };
}


async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = getDatabasePool();

  try {
    const repo = new LlmEvalRepository(pool);

    console.log(`[cheap-filter-llm-eval] sampling articles...`);
    const { inputs, report: sampleReport } = await sampleCheapFilterEvalArticles(pool, {
      sampleSize: options.sampleSize,
      sinceDays: options.sinceDays,
      sourceTier: options.sourceTier,
      decision: options.decision,
      random: options.randomSample,
    });

    console.log(
      `[cheap-filter-llm-eval] sampled ${inputs.length} articles (target ${options.sampleSize})`
    );
    for (const bucket of sampleReport.buckets) {
      console.log(`  - ${bucket.bucket}: ${bucket.found}/${bucket.requested}`);
    }
    if (inputs.length === 0) {
      console.error('[cheap-filter-llm-eval] no articles matched the sample filters.');
      process.exitCode = 2;
      return;
    }

    const runId = options.dryRun
      ? null
      : await repo.createRun({
          sampleSize: options.sampleSize,
          sinceDays: options.sinceDays,
          sourceTierFilter: options.sourceTier ?? null,
          decisionFilter: options.decision ?? null,
          modelName: options.modelName ?? defaultModel,
          promptVersion: CHEAP_FILTER_LLM_EVAL_PROMPT_VERSION,
          cliArgs: toCliArgsRecord(options),
          concurrency: options.concurrency,
          dryRun: options.dryRun,
        });

    const evaluations: Awaited<ReturnType<typeof repo.listEvaluationsForRun>> = [];
    let failed = 0;
    let processed = 0;

    const worker = async (input: CheapFilterEvalInput): Promise<void> => {
      processed += 1;
      const label = `[${processed}/${inputs.length}] ${input.articleId.slice(0, 8)}`;
      try {
        const result = await runCheapFilterLlmEval(input, { modelName: options.modelName });
        if (!options.dryRun && runId) {
          await repo.saveEvaluation({
            runId,
            articleId: input.articleId,
            evaluation: result.evaluation,
            cheapFilterDecision: input.cheapFilterDecision,
            cheapFilterScore: input.cheapFilterScore,
            cheapFilterMatchedSignals: input.matchedSignals,
            cheapFilterBlockingReasons: input.blockingReasons,
            modelName: result.modelName,
            promptVersion: result.promptVersion,
            rawLlmResponse: result.rawResponses,
            parseRetries: result.parseRetries,
          });
        }
        const scoreAssessment = result.evaluation.scoreAssessment;
        console.log(`${label} → ${result.evaluation.llmLabel} / ${scoreAssessment} (retries=${result.parseRetries})`);
      } catch (err) {
        failed += 1;
        if (err instanceof LlmEvalParseFailure) {
          console.error(`${label} → parse failure after retries: ${err.message}`);
        } else {
          console.error(`${label} → error: ${(err as Error).message}`);
        }
      }
    };

    await runWithConcurrency(inputs, options.concurrency, worker);

    if (!options.dryRun && runId) {
      evaluations.push(...(await repo.listEvaluationsForRun(runId)));
      await repo.completeRun(runId, {
        articleIds: inputs.map((i) => i.articleId),
        totalArticlesSampled: inputs.length,
        totalEvaluationsSaved: evaluations.length,
        totalEvaluationsFailed: failed,
        notes: options.notes,
      });
    } else {
      // Dry-run: no persistence; nothing to aggregate against the DB. Surface
      // a clear message so the operator knows the report wasn't produced.
      console.log('[cheap-filter-llm-eval] dry-run: skipping persistence and report generation.');
      return;
    }

    const summary = aggregateLlmEvaluations({
      runId,
      modelName: options.modelName ?? defaultModel,
      promptVersion: CHEAP_FILTER_LLM_EVAL_PROMPT_VERSION,
      totalSampled: inputs.length,
      totalFailed: failed,
      inputs,
      evaluations,
    });

    const report = generateCheapFilterLlmEvalReport({ summary, sampleArticleIds: inputs.map((i) => i.articleId) });
    const outDir = options.output ?? join(process.cwd(), 'reports');
    await mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const mdPath = join(outDir, `cheap-filter-llm-eval-${stamp}.md`);
    await writeFile(mdPath, report);

    console.log('');
    console.log('=== Cheap Filter LLM Evaluation Summary ===');
    console.log(`Run ID:                       ${runId}`);
    console.log(`Model:                        ${summary.modelName}`);
    console.log(`Prompt version:               ${summary.promptVersion}`);
    console.log(`Articles evaluated:           ${summary.totalEvaluated}`);
    console.log(`Articles failed:              ${summary.totalFailed}`);
    console.log(`Critical recall proxy:        ${pct(summary.metrics.criticalRecallProxy)}`);
    console.log(`Relevant recall proxy:        ${pct(summary.metrics.relevantRecallProxy)}`);
    console.log(`Irrelevant drop rate:         ${pct(summary.metrics.irrelevantDropRate)}`);
    console.log(`Borderline retention:         ${pct(summary.metrics.borderlineRetentionRate)}`);
    console.log(`Critical under-scored rate:   ${pct(summary.metrics.criticalUnderScoredRate)}`);
    console.log(`Irrelevant over-scored rate:  ${pct(summary.metrics.irrelevantOverScoredRate)}`);
    console.log(`Report written to:            ${mdPath}`);
  } finally {
    await pool.end();
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[cheap-filter-llm-eval] fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}