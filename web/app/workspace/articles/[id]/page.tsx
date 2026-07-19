import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { listActiveMonitoredInventory } from '../../../../../src/db/monitored-inventory';
import { draftDigestGoldFromStoredDigest } from '../../../../../src/evaluation/digest/digest-label-assist';
import type { DigestGoldFields } from '../../../../../src/evaluation/digest/digest-gold-types';
import { getWorkspaceArticle } from '../../../../../src/events/event-editorial';
import { getDigestGoldForArticle } from '../../../../../src/workspace/workspace-digest-eval-read';
import { getCveMvpArticleView, type CveMvpArticleWorkspaceView } from '../../../../../src/workspace/cve-mvp-workspace-read';
import { cvssTriageGrade } from '../../../../../src/cve/cvss-grade';
import { ConfirmSubmitScript } from '../../../../components/ConfirmSubmitScript';
import { DigestGoldForm } from '../../../../components/DigestGoldForm';
import { SiteHeader } from '../../../../components/SiteHeader';
import { WorkspaceEntityList } from '../../../../components/WorkspaceEntityList';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { getDb } from '../../../../lib/db';
import { formatWhen } from '../../../../lib/format';
import { requireAnalyst } from '../../../../lib/require-analyst';
import { requeueArticleForFilterAction } from './actions';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    requeued?: string;
    error?: string;
    gold_saved?: string;
    gold_error?: string;
    assist_error?: string;
  }>;
};

const GOLD_ERROR_MESSAGES: Record<string, string> = {
  article_not_found: 'Article not found.',
  article_not_eligible: 'Article must be DIGESTED or have an LLM digest before saving gold.',
  related_requires_inventory_match:
    'Related gold must name at least one monitored vendor or product.',
  invalid_inventory_vendor: 'One or more vendors are not in the monitored inventory.',
  invalid_inventory_product: 'One or more products are not in the monitored inventory.',
  invalid_cve: 'One or more CVE ids are invalid. Use CVE-YYYY-NNNNN.',
};

function initialDigestGoldFields(
  gold: Awaited<ReturnType<typeof getDigestGoldForArticle>>,
  storedDigest: unknown
): DigestGoldFields {
  if (gold) {
    return {
      relatedToMonitoredInventory: gold.relatedToMonitoredInventory,
      matchedVendors: gold.matchedVendors,
      matchedProducts: gold.matchedProducts,
      cves: gold.cves,
      humanReason: gold.humanReason,
    };
  }
  const fromDigest = draftDigestGoldFromStoredDigest(storedDigest);
  if (fromDigest) return fromDigest;
  return {
    relatedToMonitoredInventory: false,
    matchedVendors: [],
    matchedProducts: [],
    cves: [],
    humanReason: null,
  };
}

export async function generateMetadata({ params }: PageProps) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    return { title: 'Workspace article' };
  }
  const { id } = await params;
  const article = await getWorkspaceArticle(getDb(), id);
  return {
    title: article?.title ? `${article.title} · Workspace` : 'Workspace article',
  };
}

function formatSignalList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '—';
}

export default async function WorkspaceArticlePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { requeued, error, gold_saved, gold_error, assist_error } = await searchParams;
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? `/login?callbackUrl=${encodeURIComponent(`/workspace/articles/${id}`)}`
        : '/auth/denied'
    );
  }

  const db = getDb();
  const article = await getWorkspaceArticle(db, id);
  if (!article) notFound();

  const [gold, inventory, cveMvp] = await Promise.all([
    getDigestGoldForArticle(db, id),
    listActiveMonitoredInventory(db),
    getCveMvpArticleView(db, id),
  ]);
  const goldInitial = initialDigestGoldFields(gold, article.llmArticleDigest);
  const showDigestGold =
    article.processingStatus === 'DIGESTED' || article.llmArticleDigest != null;

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <Link className="back-link" href="/workspace/triage">
          ← Articles
        </Link>
        <p className="page-kicker">Workspace article</p>
        <h1 className="page-title">{article.title || 'Untitled article'}</h1>

        <WorkspaceNav active="triage" />

        <div className="detail-panel">
          <dl className="kv-grid">
            <div>
              <dt>Source</dt>
              <dd>{article.sourceName || '—'}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>{formatWhen(article.publishedAt)}</dd>
            </div>
            <div>
              <dt>Fetched</dt>
              <dd>{formatWhen(article.fetchedAt)}</dd>
            </div>
            <div>
              <dt>Processing</dt>
              <dd>{article.processingStatus}</dd>
            </div>
            <div>
              <dt>Extraction</dt>
              <dd>
                {(article.extractionMethod || 'unknown') + ' / ' + article.extractionStatus}
              </dd>
            </div>
            <div>
              <dt>URL</dt>
              <dd>
                {article.canonicalUrl ? (
                  <a href={article.canonicalUrl} rel="noreferrer" target="_blank">
                    Open original
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>

          <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
            Body
            {article.bodySource === 'cleanText' ? (
              <span className="meta"> · extracted text</span>
            ) : article.bodySource === 'rssSummary' ? (
              <span className="meta"> · RSS summary</span>
            ) : null}
          </h2>
          {article.bodyText ? (
            <pre className="workspace-article-body">{article.bodyText}</pre>
          ) : (
            <p className="meta">No extracted text or RSS summary.</p>
          )}

          {cveMvp ? <CveMvpSection view={cveMvp} /> : null}

          <details className="workspace-expand-section">
            <summary>Legacy pipeline signals</summary>
            <p className="meta" style={{ marginBottom: '0.75rem' }}>
              Cheap-filter, entity, digest, and classification outputs from the older
              analyst-eval / full profiles. Hidden by default on the CVE-MVP path.
            </p>

            <h2 className="page-kicker" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
              Filter signals
            </h2>
            <dl className="kv-grid">
              <div>
                <dt>Cheap filter</dt>
                <dd>{article.cheapFilterDecision ?? '—'}</dd>
              </div>
              <div>
                <dt>Vendors</dt>
                <dd>{formatSignalList(article.filterSignals.vendors)}</dd>
              </div>
              <div>
                <dt>Products</dt>
                <dd>{formatSignalList(article.filterSignals.products)}</dd>
              </div>
              <div>
                <dt>CVEs</dt>
                <dd>{formatSignalList(article.filterSignals.cves)}</dd>
              </div>
              <div>
                <dt>Critical keywords</dt>
                <dd>{formatSignalList(article.filterSignals.criticalKeywords)}</dd>
              </div>
            </dl>

            <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
              Extracted entities
            </h2>
            <WorkspaceEntityList entities={article.extractedEntities} />

            <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
              LLM digest (post-extraction)
            </h2>
            {article.llmArticleDigest == null ? (
              <p className="meta">
                No LLM digest yet (status: {article.processingStatus}).
              </p>
            ) : (
              <pre className="workspace-article-body">
                {JSON.stringify(article.llmArticleDigest, null, 2)}
              </pre>
            )}

            {showDigestGold ? (
              <>
                <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
                  Digest gold
                </h2>
                <p className="meta" style={{ marginBottom: '0.75rem' }}>
                  Human ground truth for digest eval. Saving freezes article text and inventory at
                  this moment.
                </p>
                <DigestGoldForm
                  articleId={article.id}
                  inventory={inventory}
                  initial={goldInitial}
                  saved={gold_saved === '1'}
                  saveError={gold_error ? GOLD_ERROR_MESSAGES[gold_error] ?? gold_error : undefined}
                  assistError={assist_error}
                />
              </>
            ) : null}

            <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
              LLM classification
            </h2>
            {article.llmClassification == null ? (
              <p className="meta">
                No LLM classification yet (status: {article.processingStatus}).
              </p>
            ) : (
              <pre className="workspace-article-body">
                {JSON.stringify(article.llmClassification, null, 2)}
              </pre>
            )}
          </details>

          {article.processingStatus === 'IGNORED' ? (
            <form action={requeueArticleForFilterAction} className="requeue-form">
              <input type="hidden" name="articleId" value={article.id} />
              <button
                type="submit"
                className="requeue-button"
                data-confirm="Send this article back through the cheap filter with the current inventory? The previous filter decision will be cleared, and the next scheduled sweep will re-evaluate it."
              >
                Re-queue for filter
              </button>
            </form>
          ) : null}

          {requeued ? (
            <p className="flash flash-success">
              Re-queued. The next filter sweep will re-evaluate this article.
            </p>
          ) : null}
          {error === 'article_not_ignorable' ? (
            <p className="flash flash-error">
              This article is no longer in IGNORED status and cannot be re-queued.
            </p>
          ) : null}
        </div>
      </main>
      <ConfirmSubmitScript />
    </>
  );
}

function CveMvpSection({ view }: { view: CveMvpArticleWorkspaceView }) {
  const uniqueCveCount = new Set(view.mentions.map((m) => m.cveId)).size;
  const mentions = [...view.mentions].sort((a, b) =>
    a.cveId === b.cveId ? a.zone.localeCompare(b.zone) : a.cveId.localeCompare(b.cveId)
  );

  return (
    <div className="workspace-cve-mvp">
      <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        CVE MVP intelligence
      </h2>

      <details className="workspace-expand-section" open>
        <summary>Article assessment</summary>
        <h3 className="page-kicker" style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
          AI short summary
        </h3>
        {view.summary ? (
          view.summary.status === 'completed' && view.summary.summary ? (
            <p className="meta">{view.summary.summary}</p>
          ) : (
            <TaskStatusLine
              status={view.summary.status}
              attempts={view.summary.attempts}
              lastError={view.summary.lastError}
            />
          )
        ) : (
          <p className="meta">Not scheduled.</p>
        )}

        <h3 className="page-kicker" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
          Disposition
        </h3>
        {view.disposition ? (
          view.disposition.status === 'completed' ? (
            <div className="workspace-disposition">
              <dl className="kv-grid">
                <div>
                  <dt>Decision</dt>
                  <dd>{view.disposition.disposition ?? '—'}</dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{view.disposition.reason ?? '—'}</dd>
                </div>
                <div>
                  <dt>Signals</dt>
                  <dd>
                    {view.disposition.signals.length > 0
                      ? view.disposition.signals.join(', ')
                      : '—'}
                  </dd>
                </div>
              </dl>
              <div className="workspace-disposition-reasoning">
                <p className="workspace-disposition-reasoning-label">Reasoning</p>
                <p className="workspace-disposition-reasoning-body">
                  {view.disposition.reasoning ?? '—'}
                </p>
              </div>
            </div>
          ) : (
            <TaskStatusLine
              status={view.disposition.status}
              attempts={view.disposition.attempts}
              lastError={view.disposition.lastError}
            />
          )
        ) : (
          <p className="meta">Not scheduled.</p>
        )}
      </details>

      <details className="workspace-expand-section" open>
        <summary>CVE evidence</summary>
        <h3 className="page-kicker" style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
          CVE mentions · text scan ({uniqueCveCount})
        </h3>
        {mentions.length === 0 ? (
          <p className="meta">No CVE IDs found in those fields.</p>
        ) : (
          <div className="workspace-table-wrap">
            <table className="workspace-table">
              <thead>
                <tr>
                  <th className="workspace-table-col-cve">CVE</th>
                  <th>Snippet</th>
                </tr>
              </thead>
              <tbody>
                {mentions.map((mention, idx) => (
                  <tr key={`${mention.cveId}-${mention.zone}-${idx}`}>
                    <td className="workspace-table-col-cve">
                      <span className="workspace-table-cve">{mention.cveId}</span>
                    </td>
                    <td className="meta">"{mention.snippet}"</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="page-kicker" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
          CVE scores
        </h3>
        {view.scores.length === 0 ? (
          <p className="meta">No mentioned CVEs to score.</p>
        ) : (
          <div className="workspace-table-wrap">
            <table className="workspace-table">
              <thead>
                <tr>
                  <th className="workspace-table-col-cve">CVE</th>
                  <th>NVD CVSS</th>
                  <th>CISA KEV</th>
                  <th>EPSS</th>
                  <th>Case</th>
                </tr>
              </thead>
              <tbody>
                {view.scores.map((score) => (
                  <tr key={score.cveId}>
                    <td className="workspace-table-col-cve">
                      {score.caseId ? (
                        <Link className="workspace-table-cve" href={`/workspace/cves/${score.caseId}`}>
                          {score.cveId}
                        </Link>
                      ) : (
                        <span className="workspace-table-cve">{score.cveId}</span>
                      )}
                    </td>
                    <td>
                      {score.cvssBase != null ? (
                        <span className="workspace-cvss-cell">
                          <span className={`chip ${cvssTriageGrade(score.cvssBase)}`}>
                            {cvssTriageGrade(score.cvssBase)}
                          </span>
                          <span className="workspace-table-mono">
                            {score.cvssLabel
                              ? `${score.cvssLabel.replace('CVSS ', '')} ${score.cvssBase.toFixed(1)}`
                              : score.cvssBase.toFixed(1)}
                          </span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {score.kevListed == null
                        ? '—'
                        : score.kevListed
                          ? 'Listed'
                          : 'Not listed'}
                    </td>
                    <td className="workspace-table-mono">
                      {score.epssScore != null
                        ? `${score.epssScore.toFixed(4)}${
                            score.epssPercentile != null
                              ? ` · p${score.epssPercentile.toFixed(2)}`
                              : ''
                          }`
                        : '—'}
                    </td>
                    <td>
                      {score.caseId ? (
                        <Link href={`/workspace/cves/${score.caseId}`}>Open</Link>
                      ) : (
                        <span className="meta">No case yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="page-kicker" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
          CVE interpretation · AI
        </h3>
        <p className="meta" style={{ marginBottom: '0.65rem' }}>
          Analyst-style briefing per CVE from the article: what it is and which system is
          affected, attacker impact, and why it looks serious or actionable — only what the
          article states.
        </p>
        {view.interpretation ? (
          view.interpretation.status === 'completed' ? (
            view.interpretation.results.length === 0 ? (
              <p className="meta">No interpretations yet.</p>
            ) : (
              <ul className="workspace-relevance-list">
                {view.interpretation.results.map((result) => (
                  <li key={result.cveId}>
                    <strong>{result.cveId}</strong>{' '}
                    <span className="meta">{result.interpretation}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <TaskStatusLine
              status={view.interpretation.status}
              attempts={view.interpretation.attempts}
              lastError={view.interpretation.lastError}
            />
          )
        ) : (
          <p className="meta">
            Not scheduled (requires actionable disposition and at least one CVE mention).
          </p>
        )}
      </details>

      <details className="workspace-expand-section">
        <summary>Analysis task history</summary>
        {view.taskHistory.length === 0 ? (
          <p className="meta">No analysis tasks scheduled yet.</p>
        ) : (
          <ul className="workspace-task-history">
            {view.taskHistory.map((task) => (
              <li key={`${task.taskName}-${task.status}`}>
                <span className="chip">{task.taskName}</span>{' '}
                <span className="chip">{task.status}</span>{' '}
                <span className="meta">
                  attempts {task.attempts}/{task.maxAttempts}
                  {task.lastError ? ` · ${task.lastError}` : ''}
                  {task.completedAt ? ` · completed ${formatWhen(task.completedAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function TaskStatusLine({
  status,
  attempts,
  lastError,
}: {
  status: string;
  attempts: number;
  lastError: string | null;
}) {
  return (
    <p className="meta">
      Status: {status} · attempts: {attempts}
      {lastError ? ` · ${lastError}` : ''}
    </p>
  );
}
