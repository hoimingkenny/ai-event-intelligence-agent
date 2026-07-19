import { ArticleRepository, type ArticleRecord } from '../db/repositories/article.repository.js';
import {
  AnalysisTaskRepository,
  type AnalysisTaskInput,
  type AnalysisTaskRecord,
  type AnalysisTaskStatus,
} from '../db/repositories/analysis-task.repository.js';
import { LlmAuditRepository } from '../db/repositories/llm-audit.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import { model } from '../config/llm.js';
import {
  generateArticleDisposition,
  generateArticleSummary,
  generateCveInterpretation,
  ARTICLE_CVE_INTERPRETATION_PROMPT_VERSION,
  ARTICLE_DISPOSITION_PROMPT_VERSION,
  ARTICLE_SUMMARY_PROMPT_VERSION,
  type GenerateDispositionOptions,
  type GenerateInterpretationOptions,
  type GenerateSummaryOptions,
} from '../cve/prompts.js';
import type {
  ArticleDispositionResult,
  ArticleSummary,
  CveInterpretationItem,
} from '../cve/schemas.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import { logStageArticle, logStageBatch } from '../utils/logger.js';
import { isAnalysisReady } from './cve-scan-stage.js';

export interface AnalysisTaskStageResult {
  articlesReviewed: number;
  tasksScheduled: number;
  tasksCompleted: number;
  tasksExhausted: number;
  tasksFailed: number;
}

export interface AnalysisTaskStageOptions {
  limit?: number;
  maxTasksPerRun?: number;
  concurrency?: number;
  callers?: {
    summary?: GenerateSummaryOptions['call'];
    disposition?: GenerateDispositionOptions['call'];
    interpretation?: GenerateInterpretationOptions['call'];
  };
}

const BACKOFF_SECONDS_BY_ATTEMPT = [0, 30, 120, 600, 1800];

export async function runAnalysisTaskStage(
  db: Queryable,
  options: AnalysisTaskStageOptions = {}
): Promise<AnalysisTaskStageResult> {
  const articles = new ArticleRepository(db);
  const tasks = new AnalysisTaskRepository(db);
  const audit = new LlmAuditRepository(db);

  const ready = await articles.listByProcessingStatuses(
    ['EXTRACTION_SUCCESS'],
    options.limit ?? 50
  );
  const analysisReady = ready.filter(isAnalysisReady);

  logStageBatch(
    'analysis_tasks',
    'review',
    analysisReady.map((article) => article.id)
  );

  let tasksScheduled = 0;
  for (const article of analysisReady) {
    tasksScheduled += await scheduleTasksForArticle(db, tasks, article);
  }

  const maxTasks = options.maxTasksPerRun ?? 20;

  const interpretationCallerAdapter: ((system: string, user: string) => Promise<CveInterpretationItem[]>) | undefined =
    options.callers?.interpretation
      ? async (system, user) => {
          const wrapped = await options.callers!.interpretation!(system, user);
          return wrapped.results;
        }
      : undefined;

  // Phase 1: run summary + disposition. Interpretation is only eligible after disposition
  // completes as actionable, so it is deliberately not drained yet.
  logStageBatch('analysis_tasks', 'phase1_drain_summary_disposition', analysisReady.map((a) => a.id));
  const [summaryResult, dispositionResult] = await Promise.all([
    drainTaskQueue<ArticleSummary>(
      db,
      tasks,
      audit,
      'article_summary',
      maxTasks,
      options.callers?.summary,
      async (article, caller) => {
        const result = await generateArticleSummary(article, { call: caller });
        return { summary: result.summary };
      }
    ),
    drainTaskQueue<ArticleDispositionResult>(
      db,
      tasks,
      audit,
      'article_disposition',
      maxTasks,
      options.callers?.disposition,
      async (article, caller) => generateArticleDisposition(article, { call: caller })
    ),
  ]);

  // Phase 2 (same stage / same pipeline:run): re-schedule now that disposition may be
  // complete, then drain interpretation so scan → interpretation → consolidation/scores
  // finish in one command.
  for (const article of analysisReady) {
    tasksScheduled += await scheduleTasksForArticle(db, tasks, article);
  }

  logStageBatch('analysis_tasks', 'phase2_drain_interpretation', analysisReady.map((a) => a.id));
  const interpretationResult = await drainTaskQueue<CveInterpretationItem[]>(
    db,
    tasks,
    audit,
    'article_cve_interpretation',
    maxTasks,
    interpretationCallerAdapter,
    async (article, caller, task) => {
      const cveIds = Array.isArray(task.inputPayload.cveIds) ? (task.inputPayload.cveIds as string[]) : [];
      const result = await generateCveInterpretation(
        article,
        cveIds,
        caller ? { call: async (system, user) => ({ results: await caller(system, user) }) } : {}
      );
      return { results: result };
    }
  );

  return {
    articlesReviewed: analysisReady.length,
    tasksScheduled,
    tasksCompleted: summaryResult.completed + dispositionResult.completed + interpretationResult.completed,
    tasksExhausted: summaryResult.exhausted + dispositionResult.exhausted + interpretationResult.exhausted,
    tasksFailed: summaryResult.failed + dispositionResult.failed + interpretationResult.failed,
  };
}

export async function scheduleTasksForArticle(
  db: Queryable,
  tasks: AnalysisTaskRepository,
  article: ArticleRecord
): Promise<number> {
  let scheduled = 0;
  const baseInput = {
    targetType: 'article' as const,
    targetId: article.id,
    inputPayload: { articleId: article.id },
    model,
  };

  const existing = await tasks.listForTarget('article', article.id);
  const completedByName = new Set(
    existing.filter((t) => t.status === 'completed').map((t) => t.taskName)
  );

  if (!completedByName.has('article_summary')) {
    await tasks.upsertPending({
      ...baseInput,
      taskName: 'article_summary',
      promptVersion: ARTICLE_SUMMARY_PROMPT_VERSION,
    });
    scheduled += 1;
    logStageArticle('analysis_tasks', article.id, 'scheduled', { taskName: 'article_summary' });
  }
  if (!completedByName.has('article_disposition')) {
    await tasks.upsertPending({
      ...baseInput,
      taskName: 'article_disposition',
      promptVersion: ARTICLE_DISPOSITION_PROMPT_VERSION,
    });
    scheduled += 1;
    logStageArticle('analysis_tasks', article.id, 'scheduled', { taskName: 'article_disposition' });
  }

  const disposition = existing.find(
    (t) => t.taskName === 'article_disposition' && t.status === 'completed'
  );
  const dispositionResult = disposition?.result as { disposition?: string } | undefined;
  if (dispositionResult?.disposition === 'actionable') {
    const mentions = await new ArticleRepository(db).listCveMentionsByArticle(article.id);
    const cveIds = Array.from(new Set(mentions.map((m) => m.cveId)));
    if (cveIds.length > 0 && !completedByName.has('article_cve_interpretation')) {
      await tasks.upsertPending({
        ...baseInput,
        taskName: 'article_cve_interpretation',
        inputPayload: { articleId: article.id, cveIds },
        promptVersion: ARTICLE_CVE_INTERPRETATION_PROMPT_VERSION,
      });
      scheduled += 1;
      logStageArticle('analysis_tasks', article.id, 'scheduled', {
        taskName: 'article_cve_interpretation',
        cveIds,
      });
    }
  }

  return scheduled;
}

interface DrainResult {
  completed: number;
  exhausted: number;
  failed: number;
}

async function drainTaskQueue<TSchemaResult>(
  db: Queryable,
  tasks: AnalysisTaskRepository,
  audit: LlmAuditRepository,
  taskName: 'article_summary' | 'article_disposition' | 'article_cve_interpretation',
  maxTasks: number,
  caller: ((system: string, user: string) => Promise<TSchemaResult>) | undefined,
  runner: (
    article: ArticleRecord,
    caller: ((system: string, user: string) => Promise<TSchemaResult>) | undefined,
    task: AnalysisTaskRecord
  ) => Promise<Record<string, unknown>>
): Promise<DrainResult> {
  const articles = new ArticleRepository(db);
  const drained: AnalysisTaskRecord[] = [];
  for (let i = 0; i < maxTasks; i += 1) {
    const next = await tasks.claimNextReadyTask(taskName);
    if (!next) break;
    drained.push(next);
  }

  let completed = 0;
  let exhausted = 0;
  let failed = 0;

  await runWithConcurrency(drained, 3, async (task) => {
    const article = await loadArticleForTask(articles, task);
    if (!article) {
      await tasks.recordFailure(task.id, 'article not found', 30);
      failed += 1;
      return;
    }
    const requestJson = { taskId: task.id, inputPayload: task.inputPayload };
    try {
      // When no caller is injected (production runs), the prompt helpers fall back to
      // the configured MiniMax LLM. Tests inject deterministic callers instead.
      const result = await runner(article, caller, task);
      await tasks.recordSuccess(task.id, result);
      await audit.insert({
        targetType: 'article',
        targetId: task.targetId,
        taskName: task.taskName,
        model: task.model ?? model,
        promptVersion: task.promptVersion ?? 'unknown',
        requestJson,
        responseJson: result,
        validationStatus: 'valid',
      });
      completed += 1;
      logStageArticle('analysis_tasks', task.targetId, 'completed', { taskName: task.taskName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextStatus: AnalysisTaskStatus = await tasks.recordFailure(task.id, message, backoffForAttempt(task.attempts));
      await audit.insert({
        targetType: 'article',
        targetId: task.targetId,
        taskName: task.taskName,
        model: task.model ?? model,
        promptVersion: task.promptVersion ?? 'unknown',
        requestJson,
        validationStatus: 'error',
        errorMessage: message,
      });
      if (nextStatus === 'needs_attention') exhausted += 1;
      else failed += 1;
      logStageArticle('analysis_tasks', task.targetId, nextStatus === 'needs_attention' ? 'exhausted' : 'failed', {
        taskName: task.taskName,
        error: message,
      });
    }
  });

  return { completed, exhausted, failed };
}

async function loadArticleForTask(
  articles: ArticleRepository,
  task: AnalysisTaskRecord
): Promise<ArticleRecord | null> {
  if (task.targetType !== 'article') return null;
  const ids = await articles.findByIds([task.targetId]);
  return ids[0] ?? null;
}

function backoffForAttempt(currentAttempts: number): number {
  const idx = Math.min(currentAttempts, BACKOFF_SECONDS_BY_ATTEMPT.length - 1);
  return BACKOFF_SECONDS_BY_ATTEMPT[idx];
}