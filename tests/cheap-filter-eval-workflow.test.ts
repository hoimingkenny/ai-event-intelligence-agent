import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  checkLabelDecisionConsistency,
  deriveExpectedMinimumDecision,
  deriveExpectedSignals,
  deriveSampleId,
} from '../eval/utils/derive.js';
import { loadCheapFilterDataset } from '../eval/utils/datasetLoader.js';
import { loadCandidates, writeCandidates } from '../eval/utils/candidateStore.js';
import { evaluateCheapFilterDataset } from '../eval/utils/metrics.js';
import { startEvalReviewServer } from '../eval/server/eval-review-server.js';
import type { CheapFilterCandidate } from '../eval/types/cheap-filter-eval.types.js';

describe('cheap-filter eval derivation', () => {
  it('derives the minimum decision from the human label', () => {
    expect(deriveExpectedMinimumDecision('CRITICAL_RELEVANT')).toBe('KEEP');
    expect(deriveExpectedMinimumDecision('RELEVANT')).toBe('MAYBE_KEEP');
    expect(deriveExpectedMinimumDecision('WEAK_RELEVANT')).toBe('MAYBE_KEEP');
    expect(deriveExpectedMinimumDecision('IRRELEVANT')).toBe('DROP');
  });

  it('rejects contradictory label/decision combinations', () => {
    expect(checkLabelDecisionConsistency('IRRELEVANT', 'KEEP')).toMatch(/IRRELEVANT/);
    expect(checkLabelDecisionConsistency('RELEVANT', 'DROP')).toMatch(/cannot/);
    expect(checkLabelDecisionConsistency('CRITICAL_RELEVANT', 'MAYBE_KEEP')).toMatch(/KEEP/);
    expect(checkLabelDecisionConsistency('CRITICAL_RELEVANT', 'KEEP')).toBeNull();
    expect(checkLabelDecisionConsistency('RELEVANT', 'KEEP')).toBeNull();
    expect(checkLabelDecisionConsistency('IRRELEVANT', 'DROP')).toBeNull();
  });

  it('derives expected signals from sample text and human reason', () => {
    const signals = deriveExpectedSignals({
      title: 'Emergency patch released',
      rssSummary: 'Apply the fix for CVE-2026-1111 immediately.',
      rssCategories: ['Security'],
      humanReason: 'Zero-day in monitored CyberArk PAM.',
    });
    expect(signals.cvePresent).toBe(true);
    expect(signals.criticalSignalPresent).toBe(true);
    expect(signals.monitoredVendorPresent).toBe(true);
    expect(signals.monitoredProductPresent).toBe(true);
  });

  it('derives a stable id from the url', () => {
    expect(deriveSampleId('https://example.test/a')).toBe(deriveSampleId('https://example.test/a'));
    expect(deriveSampleId('https://example.test/a')).toMatch(/^cf-[0-9a-f]{8}$/);
    expect(deriveSampleId('https://example.test/a')).not.toBe(deriveSampleId('https://example.test/b'));
  });
});

const minimalRecord = {
  sourceName: 'Bleeping Computer',
  sourceTier: 'security_media',
  url: 'https://example.test/minimal',
  title: 'CyberArk PAM zero-day actively exploited',
  rssSummary: 'Apply the emergency patch.',
  rssCategories: ['Security'],
  publishedAt: '2026-07-07T09:00:00Z',
  humanLabel: 'CRITICAL_RELEVANT',
  humanReason: 'Zero-day in monitored CyberArk PAM.',
};

describe('cheap-filter dataset loader normalization', () => {
  it('loads minimal records and derives id, minimum decision, and signals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cheap-filter-eval-'));
    const datasetPath = join(dir, 'dataset.jsonl');
    await writeFile(datasetPath, `${JSON.stringify(minimalRecord)}\n`);

    const samples = await loadCheapFilterDataset(datasetPath);

    expect(samples).toHaveLength(1);
    expect(samples[0].id).toMatch(/^cf-[0-9a-f]{8}$/);
    expect(samples[0].expectedMinimumDecision).toBe('KEEP');
    expect(samples[0].expectedSignals.monitoredVendorPresent).toBe(true);
    expect(samples[0].expectedSignals.criticalSignalPresent).toBe(true);
  });

  it('rejects records whose explicit minimum decision contradicts the label', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cheap-filter-eval-'));
    const datasetPath = join(dir, 'dataset.jsonl');
    await writeFile(
      datasetPath,
      `${JSON.stringify({ ...minimalRecord, humanLabel: 'IRRELEVANT', expectedMinimumDecision: 'KEEP' })}\n`
    );

    await expect(loadCheapFilterDataset(datasetPath)).rejects.toThrow(/line 1.*IRRELEVANT/is);
  });

  it('rejects duplicate ids and urls with line context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cheap-filter-eval-'));
    const datasetPath = join(dir, 'dataset.jsonl');
    await writeFile(datasetPath, `${JSON.stringify(minimalRecord)}\n${JSON.stringify(minimalRecord)}\n`);

    await expect(loadCheapFilterDataset(datasetPath)).rejects.toThrow(/duplicate.*line 2/i);
  });

  it('still loads the checked-in dataset', async () => {
    const samples = await loadCheapFilterDataset(join(process.cwd(), 'eval/datasets/cheap-filter-eval.jsonl'));
    expect(samples.length).toBeGreaterThanOrEqual(10);
  });
});

describe('cheap-filter gate small-dataset warning', () => {
  it('warns when the dataset has fewer than 50 samples', async () => {
    const samples = await loadCheapFilterDataset(join(process.cwd(), 'eval/datasets/cheap-filter-eval.jsonl'));
    const report = evaluateCheapFilterDataset(samples);
    expect(report.gate.warnings.some((warning) => warning.includes('fewer than 50') || warning.includes('samples'))).toBe(true);
  });
});

const candidate: CheapFilterCandidate = {
  id: deriveSampleId('https://example.test/candidate-1'),
  sourceName: 'CISA',
  sourceTier: 'government_cert',
  url: 'https://example.test/candidate-1',
  title: 'CISA adds CVE-2026-9999 to KEV catalog',
  rssSummary: 'Agencies must remediate the known exploited vulnerability.',
  rssCategories: ['Known Exploited Vulnerabilities'],
  publishedAt: '2026-07-06T12:00:00Z',
  harvest: { decision: 'KEEP', score: 105, harvestedAt: '2026-07-07T00:00:00Z' },
};

describe('eval review server', () => {
  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'cheap-filter-eval-server-'));
    const datasetPath = join(dir, 'dataset.jsonl');
    const candidatesPath = join(dir, 'candidates.jsonl');
    await writeCandidates(candidatesPath, [candidate]);
    const server = await startEvalReviewServer({ datasetPath, candidatesPath, port: 0 });
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    return { server, base, datasetPath, candidatesPath };
  }

  it('serves pending candidates and accepts labels', async () => {
    const { server, base, datasetPath } = await setup();
    try {
      const before = await (await fetch(`${base}/api/candidates`)).json();
      expect(before.pendingCount).toBe(1);
      expect(before.labeledCount).toBe(0);

      const post = await fetch(`${base}/api/labels`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          candidateId: candidate.id,
          humanLabel: 'CRITICAL_RELEVANT',
          humanReason: 'KEV listing is an urgent operational signal.',
        }),
      });
      expect(post.status).toBe(201);

      const after = await (await fetch(`${base}/api/candidates`)).json();
      expect(after.pendingCount).toBe(0);
      expect(after.labeledCount).toBe(1);

      const written = await readFile(datasetPath, 'utf8');
      expect(written).toContain(candidate.url);
      const samples = await loadCheapFilterDataset(datasetPath);
      expect(samples[0].humanLabel).toBe('CRITICAL_RELEVANT');
      expect(samples[0].expectedMinimumDecision).toBe('KEEP');

      const report = await (await fetch(`${base}/api/report`)).json();
      expect(report.metrics.datasetSize).toBe(1);
      expect(report.results[0].decision).toBe('KEEP');
    } finally {
      server.close();
    }
  });

  it('rejects double-labeling and unknown candidates', async () => {
    const { server, base } = await setup();
    try {
      const label = {
        candidateId: candidate.id,
        humanLabel: 'RELEVANT',
        humanReason: 'KEV signal.',
      };
      const first = await fetch(`${base}/api/labels`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(label),
      });
      expect(first.status).toBe(201);

      const second = await fetch(`${base}/api/labels`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(label),
      });
      expect(second.status).toBe(409);

      const unknown = await fetch(`${base}/api/labels`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...label, candidateId: 'cf-doesnotexist' }),
      });
      expect(unknown.status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('candidate store', () => {
  it('round-trips candidates and returns [] for a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cheap-filter-candidates-'));
    const path = join(dir, 'candidates.jsonl');
    expect(await loadCandidates(path)).toEqual([]);
    await writeCandidates(path, [candidate]);
    const loaded = await loadCandidates(path);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].harvest.decision).toBe('KEEP');
  });
});
