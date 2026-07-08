import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { env } from '../config/env.js';
import type { Queryable } from '../db/repositories/types.js';
import { logInfo } from '../utils/logger.js';
import { recordStageResult } from '../utils/metrics.js';
import { runAlertStage } from './alert-stage.js';
import { runClassificationStage } from './classification-stage.js';
import { runDedupStage } from './dedup-stage.js';
import { runEmbeddingStage } from './embedding-stage.js';
import { runEntityStage } from './entity-stage.js';
import { runEventEmbeddingStage } from './event-embedding-stage.js';
import { runEventStage } from './event-stage.js';
import { runExtractionStage } from './extraction-stage.js';
import { runCheapFilterStage } from './filter-stage.js';
import { runSummaryStage } from './summary-stage.js';
import { ingestRssFeeds } from './ingest-stage.js';
import { checkExtractionDrift } from '../monitoring/extraction-drift.js';
import { checkAlertLatency } from '../monitoring/alert-latency.js';

export interface PipelineRunOptions {
  limit?: number;
  includeIngest?: boolean;
  includeLlm?: boolean;
}

export interface PipelineRunResult {
  ingest?: Awaited<ReturnType<typeof ingestRssFeeds>>;
  filter: Awaited<ReturnType<typeof runCheapFilterStage>>;
  extraction: Awaited<ReturnType<typeof runExtractionStage>>;
  entities: Awaited<ReturnType<typeof runEntityStage>>;
  articleEmbeddings: Awaited<ReturnType<typeof runEmbeddingStage>>;
  dedup: Awaited<ReturnType<typeof runDedupStage>>;
  events: Awaited<ReturnType<typeof runEventStage>>;
  eventEmbeddings: Awaited<ReturnType<typeof runEventEmbeddingStage>>;
  classification?: Awaited<ReturnType<typeof runClassificationStage>>;
  summaries?: Awaited<ReturnType<typeof runSummaryStage>>;
  alerts: Awaited<ReturnType<typeof runAlertStage>>;
}

/**
 * LangGraph StateGraph orchestration of the pipeline.
 *
 * Nodes are the existing deterministic stage functions — the graph only owns
 * sequencing (linear edges, one conditional edge that skips LLM
 * classification when no API key is configured). The graph never becomes the
 * system of record: Postgres state (`articles.processing_status`) still
 * drives what each stage picks up, so a crashed run resumes by simply
 * running the graph again.
 */
const PipelineStateAnnotation = Annotation.Root({
  ingest: Annotation<PipelineRunResult['ingest']>(),
  filter: Annotation<PipelineRunResult['filter']>(),
  extraction: Annotation<PipelineRunResult['extraction']>(),
  entities: Annotation<PipelineRunResult['entities']>(),
  articleEmbeddings: Annotation<PipelineRunResult['articleEmbeddings']>(),
  dedup: Annotation<PipelineRunResult['dedup']>(),
  events: Annotation<PipelineRunResult['events']>(),
  eventEmbeddings: Annotation<PipelineRunResult['eventEmbeddings']>(),
  classification: Annotation<PipelineRunResult['classification']>(),
  summaries: Annotation<PipelineRunResult['summaries']>(),
  alerts: Annotation<PipelineRunResult['alerts']>(),
});

type PipelineState = typeof PipelineStateAnnotation.State;

export function buildPipelineGraph(
  db: Queryable,
  options: { limit: number; includeIngest: boolean; includeLlm: boolean }
) {
  const { limit, includeIngest, includeLlm } = options;

  const node =
    <K extends keyof PipelineState>(key: K, stageName: string, run: () => Promise<PipelineState[K]>) =>
    async (): Promise<Partial<PipelineState>> => {
      const result = await run();
      if (result !== undefined) recordAndLog(stageName, result as object);
      return { [key]: result } as Partial<PipelineState>;
    };

  const graph = new StateGraph(PipelineStateAnnotation)
    .addNode('ingest_stage', node('ingest', 'ingest', async () =>
      includeIngest ? ingestRssFeeds(db, { limitFeeds: limit }) : undefined
    ))
    .addNode('filter_stage', node('filter', 'filter', () => runCheapFilterStage(db, { limit })))
    .addNode('extraction_stage', node('extraction', 'extraction', () => runExtractionStage(db, { limit })))
    .addNode('extraction_drift', async () => {
      // Quality watchdog: a broken selector/site redesign is visible same-day.
      const drift = await checkExtractionDrift(db);
      recordAndLog('extraction_drift', { driftedSources: drift.driftedSources });
      return {};
    })
    .addNode('entities_stage', node('entities', 'entities', () => runEntityStage(db, { limit })))
    .addNode('article_embeddings', node('articleEmbeddings', 'article_embeddings', () =>
      runEmbeddingStage(db, { limit })
    ))
    .addNode('dedup_stage', node('dedup', 'dedup', () => runDedupStage(db, { limit })))
    .addNode('events_stage', node('events', 'events', () => runEventStage(db, { limit })))
    .addNode('event_embeddings', node('eventEmbeddings', 'event_embeddings', () =>
      runEventEmbeddingStage(db, { limit })
    ))
    .addNode('classification_stage', node('classification', 'classification', () =>
      runClassificationStage(db, { limit })
    ))
    .addNode('summary_stage', node('summaries', 'summaries', () => runSummaryStage(db, { limit })))
    .addNode('alerts_stage', node('alerts', 'alerts', () => runAlertStage(db, { limit })))
    .addNode('alert_latency', async () => {
      // Speed watchdog: publication → alert p50/p90 vs the 2h SLO.
      const latency = await checkAlertLatency(db);
      recordAndLog('alert_latency', {
        p50Hours: latency.p50Hours,
        p90Hours: latency.p90Hours,
        sloViolated: latency.sloViolated,
      });
      return {};
    })
    .addEdge(START, 'ingest_stage')
    .addEdge('ingest_stage', 'filter_stage')
    .addEdge('filter_stage', 'extraction_stage')
    .addEdge('extraction_stage', 'extraction_drift')
    .addEdge('extraction_drift', 'entities_stage')
    .addEdge('entities_stage', 'article_embeddings')
    .addEdge('article_embeddings', 'dedup_stage')
    .addEdge('dedup_stage', 'events_stage')
    .addEdge('events_stage', 'event_embeddings')
    .addConditionalEdges('event_embeddings', () => (includeLlm ? 'classification_stage' : 'alerts_stage'), [
      'classification_stage',
      'alerts_stage',
    ])
    .addEdge('classification_stage', 'summary_stage')
    .addEdge('summary_stage', 'alerts_stage')
    .addEdge('alerts_stage', 'alert_latency')
    .addEdge('alert_latency', END);

  return graph.compile();
}

export async function runPipeline(
  db: Queryable,
  options: PipelineRunOptions = {}
): Promise<PipelineRunResult> {
  const graph = buildPipelineGraph(db, {
    limit: options.limit ?? 20,
    includeIngest: options.includeIngest !== false,
    includeLlm: options.includeLlm ?? Boolean(env.minimaxApiKey),
  });

  const state = await graph.invoke({});

  return {
    ingest: state.ingest,
    filter: state.filter,
    extraction: state.extraction,
    entities: state.entities,
    articleEmbeddings: state.articleEmbeddings,
    dedup: state.dedup,
    events: state.events,
    eventEmbeddings: state.eventEmbeddings,
    classification: state.classification,
    summaries: state.summaries,
    alerts: state.alerts,
  };
}

function recordAndLog(stageName: string, result: object): void {
  recordStageResult(stageName, result);
  logInfo({ stage: stageName, result }, 'pipeline_stage_completed');
}
