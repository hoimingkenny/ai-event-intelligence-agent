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
import { startEvalReviewServer } from '../src/review/eval/eval-routes.js';
import { loadManualArticles } from '../eval/utils/manualArticles.js';
import {
  deriveVendorProductId,
  loadMonitoredVendors,
  parseVendorInventory,
  saveMonitoredVendors,
} from '../src/storage/vendorInventory.js';
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

describe('eval review server live decisions (stubbed db)', () => {
  const articleRow = {
    id: 'a-1',
    source_name: 'CISA',
    canonical_url: 'https://example.test/live-1',
    title: 'CISA advisory on exploited Exchange vulnerability',
    rss_summary: 'Known exploited vulnerability guidance.',
    rss_categories: ['Advisories'],
    published_at: new Date('2026-07-06T10:00:00Z'),
    processing_status: 'EXTRACTION_PENDING',
    cheap_filter_decision: 'KEEP',
    cheap_filter_score: 95,
    cheap_filter_reasons: ['critical_cyber_keyword_found'],
    cheap_filter_blocking_reasons: [],
    cheap_filter_matched_signals: { cves: [] },
  };
  const seenSql: string[] = [];
  const stubDb = {
    query: async (sql: string) => {
      seenSql.push(sql);
      if (sql.includes('GROUP BY')) {
        return { rows: [{ cheap_filter_decision: 'KEEP', count: '1' }] };
      }
      return { rows: [{ ...articleRow, is_manual: false }] };
    },
  } as never;

  async function setupWithDb() {
    const dir = await mkdtemp(join(tmpdir(), 'cheap-filter-live-'));
    const datasetPath = join(dir, 'dataset.jsonl');
    const candidatesPath = join(dir, 'candidates.jsonl');
    const server = await startEvalReviewServer({ datasetPath, candidatesPath, db: stubDb, port: 0 });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { server, base, datasetPath };
  }

  it('lists live filter decisions with summary and label status', async () => {
    const { server, base } = await setupWithDb();
    try {
      const data = await (await fetch(`${base}/api/decisions?decision=KEEP`)).json();
      expect(data.enabled).toBe(true);
      expect(data.summary.KEEP).toBe(1);
      expect(data.articles[0]).toMatchObject({
        articleId: 'a-1',
        sourceTier: 'government_cert',
        decision: 'KEEP',
        score: 95,
        alreadyLabeled: false,
      });
    } finally {
      server.close();
    }
  });

  it('labels a live article into the dataset and blocks relabeling', async () => {
    const { server, base, datasetPath } = await setupWithDb();
    try {
      const post = await fetch(`${base}/api/labels/from-article`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          articleId: 'a-1',
          humanLabel: 'CRITICAL_RELEVANT',
          humanReason: 'KEV-adjacent advisory for monitored Exchange.',
        }),
      });
      expect(post.status).toBe(201);

      const samples = await loadCheapFilterDataset(datasetPath);
      expect(samples[0].url).toBe('https://example.test/live-1');
      expect(samples[0].expectedMinimumDecision).toBe('KEEP');

      const data = await (await fetch(`${base}/api/decisions`)).json();
      expect(data.articles[0].alreadyLabeled).toBe(true);

      const again = await fetch(`${base}/api/labels/from-article`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articleId: 'a-1', humanLabel: 'RELEVANT', humanReason: 'dup' }),
      });
      expect(again.status).toBe(409);
    } finally {
      server.close();
    }
  });

  it('applies the origin filter to decision queries', async () => {
    const { server, base } = await setupWithDb();
    try {
      seenSql.length = 0;
      const data = await (await fetch(`${base}/api/decisions?origin=manual`)).json();
      expect(data.enabled).toBe(true);
      expect(data.articles[0].isManual).toBe(false);
      expect(seenSql.some((sql) => sql.includes("f.source_type = 'manual'") && sql.includes('LIMIT'))).toBe(true);

      seenSql.length = 0;
      await (await fetch(`${base}/api/decisions?origin=live`)).json();
      expect(seenSql.some((sql) => sql.includes('NOT EXISTS') && sql.includes('LIMIT'))).toBe(true);
    } finally {
      server.close();
    }
  });

  it('reports the live tab as disabled without a database', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cheap-filter-live-'));
    const server = await startEvalReviewServer({
      datasetPath: join(dir, 'dataset.jsonl'),
      candidatesPath: join(dir, 'candidates.jsonl'),
      port: 0,
    });
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const data = await (await fetch(`${base}/api/decisions`)).json();
      expect(data.enabled).toBe(false);
    } finally {
      server.close();
    }
  });
});

describe('manual articles loader', () => {
  it('loads minimal records with defaults and rejects duplicates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manual-articles-'));
    const path = join(dir, 'articles.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({ sourceName: 'CISA', url: 'https://manual.test/a', title: 'Test advisory' })}\n`
    );
    const articles = await loadManualArticles(path);
    expect(articles[0]).toMatchObject({ rssSummary: null, rssCategories: [], publishedAt: null });

    await writeFile(
      path,
      `${JSON.stringify({ sourceName: 'CISA', url: 'https://manual.test/a', title: 'One' })}\n` +
        `${JSON.stringify({ sourceName: 'CISA', url: 'https://manual.test/a', title: 'Two' })}\n`
    );
    await expect(loadManualArticles(path)).rejects.toThrow(/duplicate.*line 2/i);
  });

  it('validates the checked-in starter file', async () => {
    const articles = await loadManualArticles(join(process.cwd(), 'eval/datasets/manual-articles.jsonl'));
    expect(articles.length).toBeGreaterThanOrEqual(4);
  });

  it('validates the checked-in DROP-only manual file', async () => {
    const articles = await loadManualArticles(join(process.cwd(), 'eval/datasets/manual-drop-articles.jsonl'));
    expect(articles.length).toBeGreaterThanOrEqual(5);
  });
});

describe('vendor inventory store', () => {
  it('normalizes pasted entries: derives ids, dedupes aliases, rejects duplicates', () => {
    const parsed = parseVendorInventory([
      { vendor: 'Okta', product: 'Workforce Identity Cloud', aliases: ['Okta WIC', 'Okta WIC'], criticality: 'high' },
    ]);
    expect(parsed[0].id).toBe('vp_okta_workforce_identity_cloud');
    expect(parsed[0].aliases).toEqual(['Okta WIC']);
    expect(parsed[0].inProduction).toBe(true);

    expect(() =>
      parseVendorInventory([
        { vendor: 'Okta', product: 'WIC', aliases: [], criticality: 'high' },
        { vendor: 'Okta', product: 'WIC', aliases: [], criticality: 'low' },
      ])
    ).toThrow(/duplicate/i);
    expect(() => parseVendorInventory([])).toThrow();
    expect(deriveVendorProductId('CyberArk', 'Privileged Access Security')).toBe('vp_cyberark_privileged_access_security');
  });

  it('saves and reloads a custom inventory path round-trip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vendor-inventory-'));
    const path = join(dir, 'vendors.json');
    saveMonitoredVendors(
      [{ vendor: 'Okta', product: 'Workforce Identity Cloud', aliases: ['Okta WIC'], criticality: 'high', inProduction: false }],
      path
    );
    const loaded = loadMonitoredVendors(path);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ vendor: 'Okta', inProduction: false, id: 'vp_okta_workforce_identity_cloud' });
  });

  it('serves the current inventory over the api', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cheap-filter-inv-'));
    const server = await startEvalReviewServer({
      datasetPath: join(dir, 'dataset.jsonl'),
      candidatesPath: join(dir, 'candidates.jsonl'),
      port: 0,
    });
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const data = await (await fetch(`${base}/api/inventory`)).json();
      expect(Array.isArray(data.vendors)).toBe(true);
      expect(data.vendors.length).toBeGreaterThanOrEqual(1);
      expect(data.vendors[0]).toHaveProperty('aliases');
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
