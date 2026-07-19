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
  generateCveRelevance,
  ARTICLE_CVE_RELEVANCE_PROMPT_VERSION,
  ARTICLE_DISPOSITION_PROMPT_VERSION,
  ARTICLE_SUMMARY_PROMPT_VERSION,
  type GenerateDispositionOptions,
  type GenerateRelevanceOptions,
  type GenerateSummaryOptions,
} from '../cve/prompts.js';
import type {
  ArticleDispositionResult,
  ArticleSummary,
  CveRelevanceItem,
} from '../cve/schemas.js';
import { runWithConcurrency } from '../utils/concurrency.js';
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
    relevance?: GenerateRelevanceOptions['call'];
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

  let tasksScheduled = 0;
  for (const article of analysisReady) {
    tasksScheduled += await scheduleTasksForArticle(db, tasks, article);
  }

  const maxTasks = options.maxTasksPerRun ?? 20;
  const concurrency = options.concurrency ?? 3;

  const summaryQueue = drainTaskQueue<ArticleSummary>(db, tasks, audit, 'article_summary', maxTasks, options.callers?.summary, async (article, caller) => {
    const result = await generateArticleSummary(article, { call: caller });
    return { summary: result.summary };
  });
  const dispositionQueue = drainTaskQueue<ArticleDispositionResult>(db, tasks, audit, 'article_disposition', maxTasks, options.callers?.disposition, async (article, caller) => {
    return generateArticleDisposition(article, { call: caller });
  });
  const relevanceCallerAdapter: ((system: string, user: string) => Promise<CveRelevanceItem[]>) | undefined =
    options.callers?.relevance
      ? async (system, user) => {
          const wrapped = await options.callers!.relevance!(system, user);
          return wrapped.results;
        }
      : undefined;
  const relevanceQueue = drainTaskQueue<CveRelevanceItem[]>(
    db,
    tasks,
    audit,
    'article_cve_relevance',
    maxTasks,
    relevanceCallerAdapter,
    async (article, caller, task) => {
      const cveIds = Array.isArray(task.inputPayload.cveIds) ? (task.inputPayload.cveIds as string[]) : [];
      const result = await generateCveRelevance(
        article,
        cveIds,
        caller ? { call: async (system, user) => ({ results: await caller(system, user) }) } : {}
      );
      return { results: result };
    }
  );

  const [summaryResult, dispositionResult, relevanceResult] = await Promise.all([
    summaryQueue,
    dispositionQueue,
    relevanceQueue,
  ]);

  return {
    articlesReviewed: analysisReady.length,
    tasksScheduled,
    tasksCompleted: summaryResult.completed + dispositionResult.completed + relevanceResult.completed,
    tasksExhausted: summaryResult.exhausted + dispositionResult.exhausted + relevanceResult.exhausted,
    tasksFailed: summaryResult.failed + dispositionResult.failed + relevanceResult.failed,
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
  }
  if (!completedByName.has('article_disposition')) {
    await tasks.upsertPending({
      ...baseInput,
      taskName: 'article_disposition',
      promptVersion: ARTICLE_DISPOSITION_PROMPT_VERSION,
    });
    scheduled += 1;
  }

  const disposition = existing.find(
    (t) => t.taskName === 'article_disposition' && t.status === 'completed'
  );
  const dispositionResult = disposition?.result as { disposition?: string } | undefined;
  if (dispositionResult?.disposition === 'actionable') {
    const mentions = await new ArticleRepository(db).listCveMentionsByArticle(article.id);
    const cveIds = Array.from(new Set(mentions.map((m) => m.cveId)));
    if (cveIds.length > 0 && !completedByName.has('article_cve_relevance')) {
      await tasks.upsertPending({
        ...baseInput,
        taskName: 'article_cve_relevance',
        inputPayload: { articleId: article.id, cveIds },
        promptVersion: ARTICLE_CVE_RELEVANCE_PROMPT_VERSION,
      });
      scheduled += 1;
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
  taskName: 'article_summary' | 'article_disposition' | 'article_cve_relevance',
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