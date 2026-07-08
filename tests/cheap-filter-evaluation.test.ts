import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadCheapFilterDataset } from '../eval/utils/datasetLoader.js';
import { buildConfusionMatrix } from '../eval/utils/confusionMatrix.js';
import { evaluateCheapFilterSamples } from '../eval/utils/metrics.js';
import type { CheapFilterEvaluationSample, CheapFilterEvaluationResult } from '../eval/types/cheap-filter-eval.types.js';

const baseSample: CheapFilterEvaluationSample = {
  id: 'eval-base',
  sourceName: 'Bleeping Computer',
  sourceTier: 'security_media',
  url: 'https://example.test/base',
  title: 'Fortinet warns of actively exploited FortiOS vulnerability',
  rssSummary: 'Customers are urged to patch immediately.',
  rssCategories: ['Security', 'Vulnerabilities'],
  publishedAt: '2026-07-07T09:00:00Z',
  humanLabel: 'CRITICAL_RELEVANT',
  humanReason: 'Active exploitation affecting a monitored product.',
  expectedMinimumDecision: 'KEEP',
  expectedSignals: {
    monitoredVendorPresent: true,
    monitoredProductPresent: true,
    cvePresent: false,
    criticalSignalPresent: true,
    mediumSignalPresent: true,
  },
};

describe('cheap-filter evaluation dataset loader', () => {
  it('loads and validates JSONL samples', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cheap-filter-eval-'));
    const datasetPath = join(dir, 'dataset.jsonl');
    await writeFile(
      datasetPath,
      `${JSON.stringify(baseSample)}\n\n${JSON.stringify({
        ...baseSample,
        id: 'eval-irrelevant',
        url: 'https://example.test/irrelevant',
        humanLabel: 'IRRELEVANT',
        expectedMinimumDecision: 'DROP',
        title: 'Cloudflare announces product launch',
      })}\n`
    );

    const samples = await loadCheapFilterDataset(datasetPath);

    expect(samples).toHaveLength(2);
    expect(samples[0].id).toBe('eval-base');
    expect(samples[1].humanLabel).toBe('IRRELEVANT');
  });

  it('fails fast with line number context for invalid records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cheap-filter-eval-'));
    const datasetPath = join(dir, 'dataset.jsonl');
    await writeFile(datasetPath, JSON.stringify({ ...baseSample, id: '', humanLabel: 'BAD' }));

    await expect(loadCheapFilterDataset(datasetPath)).rejects.toThrow(/line 1/i);
  });
});

describe('cheap-filter evaluation metrics', () => {
  it('calculates recall, pass-through, reason coverage, and failure lists', () => {
    const criticalKeep = result('critical-keep', 'CRITICAL_RELEVANT', 'KEEP');
    const criticalMaybe = result('critical-maybe', 'CRITICAL_RELEVANT', 'MAYBE_KEEP');
    const relevantDrop = result('relevant-drop', 'RELEVANT', 'DROP');
    const irrelevantKeep = result('irrelevant-keep', 'IRRELEVANT', 'KEEP');

    const report = evaluateCheapFilterSamples([criticalKeep, criticalMaybe, relevantDrop, irrelevantKeep]);

    expect(report.metrics.criticalRecall).toBe(0.5);
    expect(report.metrics.relevantRecall).toBeCloseTo(2 / 3);
    expect(report.metrics.falseNegativeRate).toBeCloseTo(1 / 3);
    expect(report.metrics.criticalMissRate).toBe(0.5);
    expect(report.metrics.passThroughRate).toBe(0.75);
    expect(report.metrics.keepRate).toBe(0.5);
    expect(report.metrics.maybeKeepRate).toBe(0.25);
    expect(report.metrics.irrelevantPassRate).toBe(1);
    expect(report.metrics.reasonCodeCoverage).toBe(1);
    expect(report.falseNegatives.map((failure) => failure.id)).toEqual(['relevant-drop']);
    expect(report.criticalPriorityFailures.map((failure) => failure.id)).toEqual(['critical-maybe']);
    expect(report.failuresByType).toEqual({
      critical_deprioritized: 1,
      irrelevant_kept: 1,
      relevant_dropped: 1,
    });
  });

  it('builds a complete confusion matrix with zero-filled labels and decisions', () => {
    const matrix = buildConfusionMatrix([
      result('critical-keep', 'CRITICAL_RELEVANT', 'KEEP'),
      result('irrelevant-drop', 'IRRELEVANT', 'DROP'),
    ]);

    expect(matrix.CRITICAL_RELEVANT).toEqual({ KEEP: 1, MAYBE_KEEP: 0, DROP: 0 });
    expect(matrix.RELEVANT).toEqual({ KEEP: 0, MAYBE_KEEP: 0, DROP: 0 });
    expect(matrix.WEAK_RELEVANT).toEqual({ KEEP: 0, MAYBE_KEEP: 0, DROP: 0 });
    expect(matrix.IRRELEVANT).toEqual({ KEEP: 0, MAYBE_KEEP: 0, DROP: 1 });
  });

  it('writes machine and human-readable reports', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cheap-filter-report-'));
    const { runCheapFilterEvaluation } = await import('../eval/scripts/run-cheap-filter-eval.js');
    const datasetPath = join(dir, 'dataset.jsonl');
    await writeFile(datasetPath, JSON.stringify(baseSample));

    const report = await runCheapFilterEvaluation({
      datasetPath,
      outDir: dir,
      formats: ['json', 'markdown'],
      failOnThreshold: false,
    });

    const markdown = await readFile(join(dir, 'cheap-filter-report.md'), 'utf8');
    const json = JSON.parse(await readFile(join(dir, 'cheap-filter-report.json'), 'utf8')) as {
      metrics: { criticalRecall: number };
    };

    expect(report.metrics.criticalRecall).toBe(1);
    expect(json.metrics.criticalRecall).toBe(1);
    expect(markdown).toContain('Cheap Filter Evaluation Report');
    expect(markdown).toContain('Critical recall: 100.0%');
  });
});

function result(
  id: string,
  humanLabel: CheapFilterEvaluationSample['humanLabel'],
  decision: CheapFilterEvaluationResult['decision']
): CheapFilterEvaluationResult {
  return {
    sample: {
      ...baseSample,
      id,
      humanLabel,
      expectedMinimumDecision: humanLabel === 'IRRELEVANT' ? 'DROP' : humanLabel === 'CRITICAL_RELEVANT' ? 'KEEP' : 'MAYBE_KEEP',
    },
    id,
    title: baseSample.title,
    sourceName: baseSample.sourceName,
    sourceTier: baseSample.sourceTier,
    rssSummary: baseSample.rssSummary,
    humanLabel,
    humanReason: baseSample.humanReason,
    decision,
    score: decision === 'DROP' ? 0 : 50,
    reasons: decision === 'DROP' ? [] : ['test_reason'],
    blockingReasons: decision === 'DROP' ? ['test_blocking_reason'] : [],
    matchedSignals: {
      criticalCyberKeywords: decision === 'KEEP' ? ['actively exploited'] : [],
      mediumCyberKeywords: [],
      lowCyberKeywords: [],
      negativeKeywords: [],
      cves: [],
      vendors: [],
      products: [],
      rssCategories: [],
      sourceTier: baseSample.sourceTier,
    },
    passed: decision !== 'DROP',
    failed: decision === 'DROP' || (humanLabel === 'CRITICAL_RELEVANT' && decision !== 'KEEP') || (humanLabel === 'IRRELEVANT' && decision !== 'DROP'),
    failureType:
      humanLabel === 'CRITICAL_RELEVANT' && decision === 'MAYBE_KEEP'
        ? 'critical_deprioritized'
        : humanLabel === 'RELEVANT' && decision === 'DROP'
          ? 'relevant_dropped'
          : humanLabel === 'IRRELEVANT' && decision === 'KEEP'
            ? 'irrelevant_kept'
            : null,
    severity:
      humanLabel === 'CRITICAL_RELEVANT' && decision === 'MAYBE_KEEP'
        ? 'high'
        : humanLabel === 'RELEVANT' && decision === 'DROP'
          ? 'high'
          : humanLabel === 'IRRELEVANT' && decision === 'KEEP'
            ? 'low'
            : null,
    failureBucket: 'unknown',
    suggestedFix: 'manual_review_required',
  };
}
