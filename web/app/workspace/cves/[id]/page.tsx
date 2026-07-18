import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SiteHeader } from '../../../components/SiteHeader';
import { WorkspaceNav } from '../../../components/WorkspaceNav';
import { getDb } from '../../../lib/db';
import { requireAnalyst } from '../../../lib/require-analyst';
import { getCveCaseDetail } from '../../../../../src/workspace/cve-case-workspace-read';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Workspace · CVE detail',
};

export default async function WorkspaceCveDetailPage({ params }: { params: { id: string } }) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? `/login?callbackUrl=/workspace/cves/${params.id}` : '/auth/denied');
  }

  const detail = await getCveCaseDetail(getDb(), params.id);
  if (!detail) notFound();

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
          </div>
        </div>

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
          <h2 className="section-title">Article evidence</h2>
          {detail.caseArticles.length === 0 ? (
            <p className="empty-state">No articles linked.</p>
          ) : (
            <table className="workspace-table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Lifecycle state</th>
                  <th>First evidence</th>
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
