import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  CveCaseApproveAction,
  CveCaseReviewArticleAction,
} from '../../../../components/CveCaseReviewActions';
import { SiteHeader } from '../../../components/SiteHeader';
import { WorkspaceNav } from '../../../components/WorkspaceNav';
import { getDb } from '../../../lib/db';
import { requireAnalyst } from '../../../lib/require-analyst';
import { getCveCaseDetail } from '../../../../../src/workspace/cve-case-workspace-read';
import { CveCaseRepository } from '../../../../../src/db/repositories/cve-case.repository.js';
import { checkApprovalRequirements } from '../../../../../src/cve/review.js';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Workspace · CVE detail',
};

export default async function WorkspaceCveDetailPage({ params }: { params: { id: string } }) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? `/login?callbackUrl=/workspace/cves/${params.id}` : '/auth/denied');
  }

  const db = getDb();
  const detail = await getCveCaseDetail(db, params.id);
  if (!detail) notFound();

  const repo = new CveCaseRepository(db);
  const reviewEvents = await repo.listReviewEvents(params.id);
  const requirements = await checkApprovalRequirements(db, params.id);

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
              Status: <strong>{detail.case.status}</strong> · first seen {detail.case.firstSeenAt.toISOString()}
              {detail.case.lastEnrichedAt
                ? ` · last enriched ${detail.case.lastEnrichedAt.toISOString()}`
                : ' · not yet enriched'}
            </p>
            {detail.case.approvedAt ? (
              <p className="page-lede">
                Approved {detail.case.approvedAt.toISOString()}
                {detail.case.approvedByActor ? ` by ${detail.case.approvedByActor}` : ''}
                {detail.case.revertedAt
                  ? ` · auto-reverted ${detail.case.revertedAt.toISOString()}`
                  : ''}
              </p>
            ) : null}
          </div>
          <CveCaseApproveAction caseId={detail.case.id} approved={detail.case.status === 'approved'} />
        </div>

        <section className="workspace-section">
          <h2 className="section-title">Approval requirements</h2>
          <ul>
            <li>
              Human-confirmed links: <strong>{requirements.confirmedLinkCount}</strong>{' '}
              {requirements.confirmedLinkCount === 0 ? '⚠️ approval blocked' : ''}
            </li>
            <li>
              Articles missing summary:{' '}
              <strong>{requirements.articlesMissingSummary.length}</strong>
            </li>
            <li>
              Missing terminal sources:{' '}
              <strong>{requirements.missingSources.length === 0 ? 'none' : requirements.missingSources.join(', ')}</strong>
            </li>
          </ul>
        </section>

        <section className="workspace-section">
          <h2 className="section-title">Authoritative enrichment</h2>
          <dl className="kv-grid">
            <dt>NVD</dt>
            <dd>
              {detail.nvd ? (
                <>
                  <p>{detail.nvd.description ?? '—'}</p>
                  <p>
                    CVSS v3: {detail.nvd.cvssV3 ? detail.nvd.cvssV3.base : '—'}
                    {detail.nvd.cvssV3 ? ` (${detail.nvd.cvssV3.vector})` : ''}
                  </p>
                  {detail.nvd.cvssV2 ? (
                    <p>CVSS v2: {detail.nvd.cvssV2.base} ({detail.nvd.cvssV2.vector})</p>
                  ) : null}
                  {detail.nvd.lastModifiedAt ? <p>Last modified: {detail.nvd.lastModifiedAt}</p> : null}
                </>
              ) : (
                <em>NVD record unavailable</em>
              )}
            </dd>
            <dt>CISA KEV</dt>
            <dd>
              {detail.kev ? (
                detail.kev.listed ? (
                  <>
                    Listed · added {detail.kev.dateAdded ?? '—'} · due {detail.kev.dueDate ?? '—'}
                    {detail.kev.shortDescription ? <p>{detail.kev.shortDescription}</p> : null}
                  </>
                ) : (
                  'Not in KEV'
                )
              ) : (
                <em>KEV observation unavailable</em>
              )}
            </dd>
            <dt>EPSS</dt>
            <dd>
              {detail.epss ? (
                detail.epss.score != null ? (
                  <>
                    Score: {detail.epss.score.toFixed(4)} · percentile:{' '}
                    {detail.epss.percentile != null ? detail.epss.percentile.toFixed(4) : '—'} ·
                    observed {detail.epss.date ?? '—'}
                  </>
                ) : (
                  'EPSS reports no score for this CVE'
                )
              ) : (
                <em>EPSS observation unavailable</em>
              )}
            </dd>
          </dl>
        </section>

        {detail.unresolved.length > 0 ? (
          <section className="workspace-section">
            <h2 className="section-title">Unresolved</h2>
            <ul>
              {detail.unresolved.map((status, idx) => (
                <li key={idx}>{status}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="workspace-section">
          <h2 className="section-title">Article evidence &amp; verdicts</h2>
          {detail.caseArticles.length === 0 ? (
            <p className="empty-state">No articles linked.</p>
          ) : (
            <table className="workspace-table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Lifecycle state</th>
                  <th>First evidence</th>
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
                        <p className="muted">{row.article.sourceName}</p>
                      ) : null}
                    </td>
                    <td>{row.lifecycleState}</td>
                    <td>
                      <code>{JSON.stringify(row.firstEvidence ?? {})}</code>
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
          )}
        </section>

        <section className="workspace-section">
          <h2 className="section-title">Review history</h2>
          {reviewEvents.length === 0 ? (
            <p className="empty-state">No review events yet.</p>
          ) : (
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
                {reviewEvents.map((evt) => (
                  <tr key={evt.id}>
                    <td>{evt.createdAt.toISOString()}</td>
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
          )}
        </section>

        <section className="workspace-section">
          <h2 className="section-title">Source observation history</h2>
          {detail.currentObservations.length === 0 ? (
            <p className="empty-state">No source observations yet.</p>
          ) : (
            <table className="workspace-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Retrieved</th>
                  <th>Provenance</th>
                </tr>
              </thead>
              <tbody>
                {detail.currentObservations.map(({ source, observation }) => (
                  <tr key={observation.id}>
                    <td>{source}</td>
                    <td>{observation.status}</td>
                    <td>{observation.retrievedAt.toISOString()}</td>
                    <td>{observation.provenance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
