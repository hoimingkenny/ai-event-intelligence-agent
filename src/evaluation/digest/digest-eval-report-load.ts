import { DigestGoldRepository } from '../../db/repositories/digest-gold.repository.js';
import type { Queryable } from '../../db/repositories/types.js';
import { evaluateDigestEvalSamples } from '../../../eval/utils/digest-metrics.js';
import type {
  DigestEvalPredictionFields,
  DigestEvalReport,
  DigestEvalScoredSample,
} from '../../../eval/types/digest-eval.types.js';
import { DigestEvalRepository, type DigestEvalRunRecord } from './digest-eval-repository.js';

export async function loadDigestEvalReportForRun(
  db: Queryable,
  runId: string
): Promise<{ run: DigestEvalRunRecord; report: DigestEvalReport } | null> {
  const evalRepo = new DigestEvalRepository(db);
  const goldRepo = new DigestGoldRepository(db);
  const run = await evalRepo.findRunById(runId);
  if (!run || !run.finishedAt) return null;

  const [goldRows, predictions] = await Promise.all([
    goldRepo.listAllForEval(),
    evalRepo.listPredictionsForRun(runId),
  ]);
  const goldByArticle = new Map(goldRows.map((row) => [row.articleId, row]));

  const samples: DigestEvalScoredSample[] = [];
  for (const predictionRow of predictions) {
    const gold = goldByArticle.get(predictionRow.articleId);
    if (!gold) continue;
    samples.push({
      articleId: predictionRow.articleId,
      gold: {
        relatedToMonitoredInventory: gold.relatedToMonitoredInventory,
        matchedVendors: gold.matchedVendors,
        matchedProducts: gold.matchedProducts,
        cves: gold.cves,
        humanReason: gold.humanReason,
      },
      prediction: predictionRow.prediction ?? emptyPrediction(),
    });
  }

  let comparisonBaselineMetrics = null;
  if (run.comparisonBaselineRunId) {
    const baselineSamples = await loadScoredSamples(
      db,
      run.comparisonBaselineRunId,
      goldByArticle
    );
    if (baselineSamples.length > 0) {
      comparisonBaselineMetrics = evaluateDigestEvalSamples(baselineSamples).metrics;
    }
  }

  const report = evaluateDigestEvalSamples(samples, {
    mode: run.mode,
    runId: run.id,
    promptVersion: run.promptVersion,
    modelName: run.modelName,
    comparisonBaselineRunId: run.comparisonBaselineRunId,
    comparisonBaselineMetrics,
  });

  return { run, report };
}

async function loadScoredSamples(
  db: Queryable,
  runId: string,
  goldByArticle: Map<string, { relatedToMonitoredInventory: boolean; matchedVendors: string[]; matchedProducts: string[]; cves: string[]; humanReason: string | null }>
): Promise<DigestEvalScoredSample[]> {
  const predictions = await new DigestEvalRepository(db).listPredictionsForRun(runId);
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

function emptyPrediction(): DigestEvalPredictionFields {
  return {
    relatedToMonitoredInventory: false,
    matchedVendors: [],
    matchedProducts: [],
    cves: [],
  };
}
