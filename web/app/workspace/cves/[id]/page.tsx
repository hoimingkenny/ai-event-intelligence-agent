import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  CveCaseUnpublishAction,
  CveCaseReviewArticleAction,
} from '../../../../components/CveCaseReviewActions';
import { SiteHeader } from '../../../../components/SiteHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { WorkspacePagination } from '../../../../components/WorkspacePagination';
import { getDb } from '../../../../lib/db';
import { formatWhen } from '../../../../lib/format';
import { requireAnalyst } from '../../../../lib/require-analyst';
import {
  CVE_REVIEW_HISTORY_PAGE_SIZE,
  parseWorkspacePage,
  workspacePageOffset,
  workspaceTotalPages,
} from '../../../../lib/workspace-page';
import { getCveCaseDetail } from '../../../../../src/workspace/cve-case-workspace-read';
import {
  CveCaseRepository,
  type CveSourceObservationRecord,
} from '../../../../../src/db/repositories/cve-case.repository.js';
import { CVSS_AUTO_PUBLISH_THRESHOLD } from '../../../../../src/cve/review.js';
import type { CveSourceName } from '../../../../../src/db/repositories/cve-case.repository.js';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Workspace · CVE detail',
};

function hasFailedObservation(
  rows: Array<{ source: CveSourceName; observation: CveSourceObservationRecord }>,
  source: CveSourceName
): boolean {
  const row = rows.find((r) => r.source === source);
  if (!row) return false;
  return row.observation.status === 'failed' || row.observation.status === 'transient_failure';
}

function evidenceSummary(firstEvidence: Record<string, unknown> | null): string {
  if (!firstEvidence) return '—';
  const interpretation = firstEvidence.automated_interpretation;
  if (typeof interpretation === 'string' && interpretation.trim()) return interpretation;
  return JSON.stringify(firstEvidence);
}

function formatEnrichmentDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return trimmed;
}

function lifecycleLabel(
  state:
    | 'mentioned'
    | 'automated_relevant'
    | 'human_confirmed'
    | 'human_rejected'
    | 'human_uncertain'
): string {
  switch (state) {
    case 'human_confirmed':
      return 'Confirmed';
    case 'human_rejected':
      return 'Rejected';
    case 'human_uncertain':
      return 'Uncertain';
    case 'automated_relevant':
      return 'Auto relevant';
    case 'mentioned':
      return 'Mentioned';
  }
}

export default async function WorkspaceCveDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? `/login?callbackUrl=/workspace/cves/${id}`
        : '/auth/denied'
    );
  }

  const db = getDb();
  const detail = await getCveCaseDetail(db, id);
  if (!detail) notFound();

  const repo = new CveCaseRepository(db);
  const reviewEvents = await repo.listReviewEvents(id);
  const allObservations = await repo.listSourceObservations(id);

  const { page: pageRaw } = await searchParams;
  const totalPages = workspaceTotalPages(reviewEvents.length, CVE_REVIEW_HISTORY_PAGE_SIZE);
  const page = Math.min(parseWorkspacePage(pageRaw), totalPages);
  const reviewPageEvents = reviewEvents.slice(
    workspacePageOffset(page, CVE_REVIEW_HISTORY_PAGE_SIZE),
    workspacePageOffset(page, CVE_REVIEW_HISTORY_PAGE_SIZE) + CVE_REVIEW_HISTORY_PAGE_SIZE
  );

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <WorkspaceNav active="cves" />
        <div className="workspace-toolbar">
          <div>
            <p className="page-kicker">
              <Link href="/workspace/cves">← All CVEs</Link>
            </p>
            <h1 className="page-title">{detail.case.cveId}</h1>
            <p className="page-lede">
              <span className={`workspace-status status-${detail.case.status}`}>
                {detail.case.status}
              </span>
              {' · '}
              first seen {formatWhen(detail.case.firstSeenAt)}
              {detail.case.lastEnrichedAt
                ? ` · last enriched ${formatWhen(detail.case.lastEnrichedAt)}`
                : ' · not yet enriched'}
            </p>
          </div>
          <CveCaseUnpublishAction
            caseId={detail.case.id}
            approved={detail.case.status === 'approved'}
          />
        </div>

        {detail.case.status === 'approved' ? (
          <div className="flash flash-success" role="status">
            Published on the high-alert CVE catalogue
            {detail.case.approvedAt ? ` · ${formatWhen(detail.case.approvedAt)}` : ''}
            {detail.case.approvedByActor ? ` · ${detail.case.approvedByActor}` : ''}.
            Cases with NVD CVSS ≥ {CVSS_AUTO_PUBLISH_THRESHOLD} or a CISA KEV listing
            publish automatically.
          </div>
        ) : (
          <div className="flash" role="status">
            Draft — publishes automatically when NVD CVSS is ≥ {CVSS_AUTO_PUBLISH_THRESHOLD} or
            the CVE is listed in CISA KEV.
          </div>
        )}
        {detail.case.revertedAt ? (
          <div className="flash flash-error" role="status">
            Pulled back {formatWhen(detail.case.revertedAt)}
            {detail.case.revertedByActor ? ` by ${detail.case.revertedByActor}` : ''}.
            A later enrichment refresh may republish if CVSS is still ≥{' '}
            {CVSS_AUTO_PUBLISH_THRESHOLD} or KEV still lists the CVE.
          </div>
        ) : null}

        <details className="workspace-expand-section" open>
          <summary>Authoritative enrichment</summary>
          <dl className="kv-grid workspace-enrichment-grid">
            <div>
              <dt>NVD</dt>
              <dd>
                {detail.nvd ? (
                  <div className="enrichment-block">
                    <p className="enrichment-facts">
                      CVSS v3:{' '}
                      <strong>{detail.nvd.cvssV3 ? detail.nvd.cvssV3.base : '—'}</strong>
                      {detail.nvd.cvssV2 ? (
                        <>
                          {' · '}CVSS v2: <strong>{detail.nvd.cvssV2.base}</strong>
                        </>
                      ) : null}
                    </p>
                    {detail.nvd.cvssV3?.vector ? (
                      <p className="enrichment-vector">{detail.nvd.cvssV3.vector}</p>
                    ) : null}
                    {detail.nvd.cvssV2?.vector ? (
                      <p className="enrichment-vector">{detail.nvd.cvssV2.vector}</p>
                    ) : null}
                    {detail.nvd.description ? (
                      <p className="enrichment-body">{detail.nvd.description}</p>
                    ) : null}
                    {detail.nvd.lastModifiedAt ? (
                      <p className="enrichment-meta">
                        Modified {formatEnrichmentDate(detail.nvd.lastModifiedAt)}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <em>NVD record unavailable</em>
                    {hasFailedObservation(detail.currentObservations, 'nvd') ? (
                      <p className="form-error">
                        Latest refresh failed; the prior NVD record (if any) is retained.
                      </p>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>CISA KEV</dt>
              <dd>
                {detail.kev ? (
                  detail.kev.listed ? (
                    <div className="enrichment-block">
                      <p className="enrichment-facts">
                        <strong>Listed</strong>
                      </p>
                      {detail.kev.shortDescription ? (
                        <p className="enrichment-body">{detail.kev.shortDescription}</p>
                      ) : null}
                      <p className="enrichment-meta">
                        Added {detail.kev.dateAdded ?? '—'}
                        {' · '}Due {detail.kev.dueDate ?? '—'}
                      </p>
                    </div>
                  ) : (
                    <div className="enrichment-block">
                      <p className="enrichment-facts">Not in KEV</p>
                    </div>
                  )
                ) : (
                  <>
                    <em>KEV observation unavailable</em>
                    {hasFailedObservation(detail.currentObservations, 'kev') ? (
                      <p className="form-error">
                        Latest refresh failed; prior KEV status is retained.
                      </p>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>EPSS</dt>
              <dd>
                {detail.epss ? (
                  detail.epss.score != null ? (
                    <div className="enrichment-block">
                      <p className="enrichment-facts">
                        Score: <strong>{detail.epss.score.toFixed(4)}</strong>
                        {' · '}
                        Percentile:{' '}
                        <strong>
                          {detail.epss.percentile != null
                            ? detail.epss.percentile.toFixed(4)
                            : '—'}
                        </strong>
                      </p>
                      {detail.epss.date ? (
                        <p className="enrichment-meta">Observed {detail.epss.date}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="enrichment-block">
                      <p className="enrichment-facts">No EPSS score</p>
                    </div>
                  )
                ) : (
                  <>
                    <em>EPSS observation unavailable</em>
                    {hasFailedObservation(detail.currentObservations, 'epss') ? (
                      <p className="form-error">
                        Latest refresh failed; prior EPSS score (if any) is retained.
                      </p>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
          </dl>

          {detail.unresolved.length > 0 ? (
            <div className="workspace-unresolved">
              <p className="workspace-disposition-reasoning-label">Unresolved</p>
              <ul className="workspace-plain-list">
                {detail.unresolved.map((status, idx) => (
                  <li key={idx}>{status}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </details>

        <details className="workspace-expand-section" open>
          <summary>Article evidence &amp; verdicts</summary>
          {detail.caseArticles.length === 0 ? (
            <p className="empty-state">No articles linked.</p>
          ) : (
            <div className="workspace-table-wrap">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th>Evidence</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.caseArticles.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/workspace/articles/${row.article.id}`}>
                          {row.article.title ?? row.article.canonicalUrl ?? row.article.id}
                        </Link>
                        {row.article.sourceName ? (
                          <p className="meta">{row.article.sourceName}</p>
                        ) : null}
                        <span
                          className={`workspace-lifecycle workspace-lifecycle-${row.lifecycleState}`}
                        >
                          {lifecycleLabel(row.lifecycleState)}
                        </span>
                      </td>
                      <td>
                        <p className="workspace-evidence-blurb">
                          {evidenceSummary(row.firstEvidence)}
                        </p>
                      </td>
                      <td>
                        <CveCaseReviewArticleAction
                          caseId={detail.case.id}
                          articleId={row.article.id}
                          currentState={row.lifecycleState}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>

        <details className="workspace-expand-section" open>
          <summary>Review history</summary>
          {reviewEvents.length === 0 ? (
            <p className="empty-state">No review events yet.</p>
          ) : (
            <>
              <div className="workspace-table-wrap">
                <table className="workspace-table">
                  <thead>
                    <tr>
                      <th>At</th>
                      <th>Actor</th>
                      <th>Event</th>
                      <th>Transition</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewPageEvents.map((evt) => (
                      <tr key={evt.id}>
                        <td>
                          <time
                            className="workspace-table-when"
                            dateTime={evt.createdAt.toISOString()}
                          >
                            {formatWhen(evt.createdAt)}
                          </time>
                        </td>
                        <td>{evt.actor}</td>
                        <td>{evt.eventKind}</td>
                        <td>
                          {evt.fromState ?? '—'} → {evt.toState ?? '—'}
                        </td>
                        <td>{evt.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <WorkspacePagination
                basePath={`/workspace/cves/${id}`}
                page={page}
                total={reviewEvents.length}
                limit={CVE_REVIEW_HISTORY_PAGE_SIZE}
              />
            </>
          )}
        </details>

        <details className="workspace-expand-section">
          <summary>Enrichment ops</summary>
          <p className="meta" style={{ marginBottom: '0.75rem' }}>
            Refresh cursors and append-only observation history for NVD / KEV / EPSS.
          </p>

          <h3 className="page-kicker" style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
            Refresh freshness
          </h3>
          <ul className="workspace-plain-list">
            {detail.freshness.map((entry) => {
              const last = entry.lastCheckedAt ? formatWhen(entry.lastCheckedAt) : 'never';
              const status = entry.lastTickStatus ?? 'no tick yet';
              return (
                <li key={entry.source}>
                  <strong>{entry.source.toUpperCase()}</strong>: last check {last} ({status})
                  {entry.lastError ? (
                    <p className="form-error">last error: {entry.lastError}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <h3 className="page-kicker" style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>
            Source observation history
          </h3>
          {allObservations.length === 0 ? (
            <p className="empty-state">No source observations yet.</p>
          ) : (
            <div className="workspace-table-wrap">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Retrieved</th>
                    <th>Attempt</th>
                    <th>Provenance / error</th>
                  </tr>
                </thead>
                <tbody>
                  {allObservations.map((obs) => (
                    <tr key={obs.id}>
                      <td>{obs.source}</td>
                      <td>{obs.status}</td>
                      <td>
                        <time
                          className="workspace-table-when"
                          dateTime={obs.retrievedAt.toISOString()}
                        >
                          {formatWhen(obs.retrievedAt)}
                        </time>
                      </td>
                      <td>{obs.attemptKind}</td>
                      <td>
                        {obs.provenance}
                        {obs.lastError ? (
                          <p className="form-error">{obs.lastError}</p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </main>
    </>
  );
}
