'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { DigestEvalReport } from '../../eval/types/digest-eval.types';
import type { DigestAgreementReport } from '../../src/evaluation/digest/digest-agreement';
import {
  runDigestAgreementAction,
  runDigestBaselineAction,
  runDigestRegenAction,
} from '../app/workspace/eval/digest/reports/actions';

export interface DigestEvalRunListItem {
  id: string;
  mode: 'baseline' | 'regen';
  promptVersion: string;
  modelName: string | null;
  finishedAt: string | null;
}

export interface DigestEvalReportsPanelProps {
  labeledCount: number;
  softGateMinGold: number;
  softGatesActive: boolean;
  runs: DigestEvalRunListItem[];
  selectedRunId: string | null;
  selectedReport: DigestEvalReport | null;
  flash?: string | null;
  error?: string | null;
}

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'n/a';
  const pct = (value * 100).toFixed(1);
  return value >= 0 ? `+${pct}%` : `${pct}%`;
}

function formatWhen(value: Date | string | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleString();
}

export function DigestEvalReportsPanel({
  labeledCount,
  softGateMinGold,
  softGatesActive,
  runs,
  selectedRunId,
  selectedReport,
  flash,
  error,
}: DigestEvalReportsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [agreement, setAgreement] = useState<DigestAgreementReport | null>(null);
  const [agreementError, setAgreementError] = useState<string | null>(null);

  function onSelectRun(runId: string) {
    const params = new URLSearchParams();
    if (runId) params.set('run', runId);
    router.push(`/workspace/eval/digest/reports?${params.toString()}`);
  }

  function handleAgreement() {
    if (!selectedRunId) {
      setAgreementError('Select a run first.');
      return;
    }
    setAgreement(null);
    setAgreementError(null);
    startTransition(async () => {
      const result = await runDigestAgreementAction(selectedRunId);
      if ('error' in result) {
        setAgreementError(result.error);
        return;
      }
      setAgreement(result.report);
    });
  }

  const failures =
    selectedReport?.results.filter((result) => result.failures.length > 0) ?? [];

  return (
    <div style={{ marginTop: '1rem', display: 'grid', gap: '1.25rem' }}>
      {flash ? (
        <p className="flash" role="status">
          {flash}
        </p>
      ) : null}
      {error ? (
        <p className="flash flash-error" role="alert">
          {error}
        </p>
      ) : null}

      {!softGatesActive ? (
        <p className="flash" role="status">
          Soft gates inactive — {labeledCount} / {softGateMinGold} gold labels. Metrics still
          compute; warn thresholds apply once you reach {softGateMinGold}.
        </p>
      ) : (
        <p className="meta">
          Soft gates active ({labeledCount} gold labels ≥ {softGateMinGold}).
        </p>
      )}

      <section className="detail-panel">
        <h2 className="page-kicker">Run eval</h2>
        <p className="meta">
          Baseline scores stored production digests. Regen calls the current digest prompt offline
          and never overwrites <code>articles.llm_article_digest</code>.
        </p>
        <div className="form-actions" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <form action={runDigestBaselineAction}>
            <button className="auth-button" type="submit" disabled={pending || labeledCount === 0}>
              Run baseline
            </button>
          </form>
          <form action={runDigestRegenAction}>
            <button
              className="auth-button secondary"
              type="submit"
              disabled={pending || labeledCount === 0}
            >
              Run regen
            </button>
          </form>
        </div>
      </section>

      <section className="detail-panel">
        <h2 className="page-kicker">Run picker</h2>
        {runs.length === 0 ? (
          <p className="meta">No finished digest eval runs yet. Run baseline first.</p>
        ) : (
          <label className="field">
            <span>Finished run</span>
            <select
              value={selectedRunId ?? ''}
              onChange={(event) => onSelectRun(event.target.value)}
            >
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.mode} · {run.promptVersion}
                  {run.modelName ? ` · ${run.modelName}` : ''} ·{' '}
                  {formatWhen(run.finishedAt)} · {run.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {selectedReport ? (
        <section className="detail-panel">
          <h2 className="page-kicker">Scorecard</h2>
          <p className="meta">
            Mode {selectedReport.mode} · prompt {selectedReport.promptVersion}
            {selectedReport.modelName ? ` · ${selectedReport.modelName}` : ''} · gold{' '}
            {selectedReport.metrics.goldCount}
          </p>

          <dl className="kv-grid">
            <div>
              <dt>Relatedness F1</dt>
              <dd>{formatRate(selectedReport.metrics.relatednessF1)}</dd>
            </div>
            <div>
              <dt>Vendor exact</dt>
              <dd>{formatRate(selectedReport.metrics.vendorExactMatchRate)}</dd>
            </div>
            <div>
              <dt>Product exact</dt>
              <dd>{formatRate(selectedReport.metrics.productExactMatchRate)}</dd>
            </div>
            <div>
              <dt>CVE exact</dt>
              <dd>{formatRate(selectedReport.metrics.cveExactMatchRate)}</dd>
            </div>
            <div>
              <dt>Vendor set-F1</dt>
              <dd>{formatRate(selectedReport.metrics.vendorSetF1)}</dd>
            </div>
            <div>
              <dt>Product set-F1</dt>
              <dd>{formatRate(selectedReport.metrics.productSetF1)}</dd>
            </div>
            <div>
              <dt>CVE set-F1</dt>
              <dd>{formatRate(selectedReport.metrics.cveSetF1)}</dd>
            </div>
          </dl>

          <h3 className="page-kicker" style={{ marginTop: '1rem' }}>
            Soft gates
          </h3>
          <p className="meta">
            {selectedReport.gate.active ? 'Active' : 'Inactive'}
            {selectedReport.gate.warnings.length === 0
              ? ' · no warnings'
              : ` · ${selectedReport.gate.warnings.length} warning(s)`}
          </p>
          {selectedReport.gate.warnings.length > 0 ? (
            <ul className="meta">
              {selectedReport.gate.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          {selectedReport.comparisonDelta ? (
            <>
              <h3 className="page-kicker" style={{ marginTop: '1rem' }}>
                vs baseline
              </h3>
              <p className="meta">
                Baseline run {selectedReport.comparisonBaselineRunId?.slice(0, 8) ?? '—'}
              </p>
              <ul className="meta">
                <li>
                  Relatedness F1 Δ {formatSigned(selectedReport.comparisonDelta.relatednessF1)}
                </li>
                <li>
                  Vendor exact Δ{' '}
                  {formatSigned(selectedReport.comparisonDelta.vendorExactMatchRate)}
                </li>
                <li>
                  Product exact Δ{' '}
                  {formatSigned(selectedReport.comparisonDelta.productExactMatchRate)}
                </li>
                <li>
                  CVE exact Δ {formatSigned(selectedReport.comparisonDelta.cveExactMatchRate)}
                </li>
              </ul>
            </>
          ) : null}

          <h3 className="page-kicker" style={{ marginTop: '1rem' }}>
            Sample failures ({failures.length})
          </h3>
          {failures.length === 0 ? (
            <p className="meta">No failures.</p>
          ) : (
            <ul className="triage-grid">
              {failures.slice(0, 40).map((result) => (
                <li key={result.articleId}>
                  <div className="triage-title-row">
                    <a
                      className="triage-title"
                      href={`/workspace/articles/${result.articleId}`}
                    >
                      <span className="triage-mono">#{result.articleId}</span>
                    </a>
                  </div>
                  <p className="meta">{result.failures.join('; ')}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="detail-panel">
        <h2 className="page-kicker">Agreement report (diagnostic)</h2>
        <p className="meta">
          On-demand LLM judge of gold vs the selected run&apos;s predictions. Not a gate metric and
          never writes gold.
        </p>
        <button
          className="auth-button secondary"
          type="button"
          disabled={pending || !selectedRunId}
          onClick={handleAgreement}
        >
          {pending ? 'Running…' : 'Run agreement report'}
        </button>
        {agreementError ? (
          <p className="flash flash-error" role="alert">
            {agreementError}
          </p>
        ) : null}
        {agreement ? (
          <div style={{ marginTop: '1rem' }}>
            <p className="meta">
              Samples {agreement.sampleCount} · related agree {formatRate(agreement.relatedAgreeRate)}{' '}
              · vendor {formatRate(agreement.vendorAgreeRate)} · product{' '}
              {formatRate(agreement.productAgreeRate)} · CVE {formatRate(agreement.cveAgreeRate)}
            </p>
            <ul className="triage-grid">
              {agreement.samples.slice(0, 40).map((sample) => (
                <li key={sample.articleId}>
                  <div className="triage-title-row">
                    <span className="triage-mono">#{sample.articleId}</span>
                    <span className="chip">
                      related {sample.judgement.relatedAgree ? 'agree' : 'disagree'}
                    </span>
                    {sample.judgement.vendorsAgree !== null ? (
                      <span className="chip">
                        vendors {sample.judgement.vendorsAgree ? 'agree' : 'disagree'}
                      </span>
                    ) : null}
                    {sample.judgement.productsAgree !== null ? (
                      <span className="chip">
                        products {sample.judgement.productsAgree ? 'agree' : 'disagree'}
                      </span>
                    ) : null}
                    <span className="chip">
                      cves {sample.judgement.cvesAgree ? 'agree' : 'disagree'}
                    </span>
                  </div>
                  <p className="meta">{sample.judgement.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
