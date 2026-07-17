import { join } from 'node:path';
import { DigestGoldRepository } from '../db/repositories/digest-gold.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import type { DigestEvalReport } from '../../eval/types/digest-eval.types.js';
import { DIGEST_EVAL_SOFT_GATE_MIN_GOLD } from '../../eval/types/digest-eval.types.js';
import {
  DigestEvalRepository,
  type DigestEvalRunRecord,
} from '../evaluation/digest/digest-eval-repository.js';
import { loadDigestEvalReportForRun } from '../evaluation/digest/digest-eval-report-load.js';
import { runDigestEval } from '../evaluation/digest/digest-eval-runner.js';
import {
  runDigestAgreementReport,
  type DigestAgreementReport,
  type DigestAgreementSampleInput,
} from '../evaluation/digest/digest-agreement.js';

export interface DigestEvalReportsSnapshot {
  labeledCount: number;
  softGateMinGold: number;
  softGatesActive: boolean;
  runs: DigestEvalRunRecord[];
  selectedRun: DigestEvalRunRecord | null;
  selectedReport: DigestEvalReport | null;
}

export async function getDigestEvalReportsSnapshot(
  db: Queryable,
  options: { selectedRunId?: string | null; runLimit?: number } = {}
): Promise<DigestEvalReportsSnapshot> {
  const goldRepo = new DigestGoldRepository(db);
  const evalRepo = new DigestEvalRepository(db);
  const [labeledCount, runs] = await Promise.all([
    goldRepo.countLabels(),
    evalRepo.listFinishedRuns({ limit: options.runLimit ?? 50 }),
  ]);

  let selectedRun: DigestEvalRunRecord | null = null;
  let selectedReport: DigestEvalReport | null = null;

  const preferredId =
    options.selectedRunId ??
    runs.find((run) => run.mode === 'baseline')?.id ??
    runs[0]?.id ??
    null;

  if (preferredId) {
    const loaded = await loadDigestEvalReportForRun(db, preferredId);
    if (loaded) {
      selectedRun = loaded.run;
      selectedReport = loaded.report;
    }
  }

  return {
    labeledCount,
    softGateMinGold: DIGEST_EVAL_SOFT_GATE_MIN_GOLD,
    softGatesActive: labeledCount >= DIGEST_EVAL_SOFT_GATE_MIN_GOLD,
    runs,
    selectedRun,
    selectedReport,
  };
}

export async function runDigestEvalFromWorkspace(
  db: Queryable,
  mode: 'baseline' | 'regen'
): Promise<{ runId: string; report: DigestEvalReport }> {
  const result = await runDigestEval(db, {
    mode,
    outDir: join(process.cwd(), 'eval/reports'),
    formats: [],
  });
  return { runId: result.runId, report: result.report };
}

export async function runDigestAgreementFromWorkspace(
  db: Queryable,
  runId: string
): Promise<DigestAgreementReport> {
  const loaded = await loadDigestEvalReportForRun(db, runId);
  if (!loaded) {
    throw new Error('Digest eval run not found or unfinished.');
  }

  const goldRepo = new DigestGoldRepository(db);
  const goldRows = await goldRepo.listAllForEval();
  const titleByArticle = new Map(
    goldRows.map((row) => [row.articleId, row.articleSnapshot.title])
  );

  const samples: DigestAgreementSampleInput[] = loaded.report.results.map((result) => ({
    articleId: result.articleId,
    title: titleByArticle.get(result.articleId) ?? null,
    gold: result.gold,
    prediction: result.prediction,
  }));

  return runDigestAgreementReport(samples, { runId });
}
