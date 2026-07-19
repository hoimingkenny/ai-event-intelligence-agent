import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '../../../components/SiteHeader';
import { getDb } from '../../../lib/db';
import { CVSS_AUTO_PUBLISH_ACTOR } from '../../../../src/cve/review';
import { getPublicCveDetail } from '../../../../src/public/public-cve-read';
import { formatWhen } from '../../../lib/format';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

function formatEnrichmentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function publishByLabel(actor: string | null | undefined): string | null {
  if (!actor) return null;
  if (actor === CVSS_AUTO_PUBLISH_ACTOR) return 'System';
  return actor;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const detail = await getPublicCveDetail(getDb(), decodeURIComponent(id));
  return {
    title: detail?.case.cveId ?? 'CVE',
  };
}

export default async function PublicCveDetailPage({ params }: PageProps) {
  const { id } = await params;
  const detail = await getPublicCveDetail(getDb(), decodeURIComponent(id));
  if (!detail) notFound();

  const { case: cve, nvd, kev, epss, articles } = detail;
  const publishedBy = publishByLabel(cve.approvedByActor);

  return (
    <>
      <SiteHeader active="cves" />
      <main className="page">
        <p className="page-kicker">
          <Link href="/cves">← High-alert CVEs</Link>
        </p>
        <h1 className="page-title">{cve.cveId}</h1>
        <p className="page-lede">
          Published {formatWhen(cve.approvedAt)}
          {publishedBy ? ` · Published by ${publishedBy}` : ''}
        </p>

        <section className="workspace-section">
          <h2 className="section-title">Authoritative enrichment</h2>
          <dl className="kv-grid workspace-enrichment-grid">
            <div>
              <dt>NVD</dt>
              <dd>
                {nvd ? (
                  <div className="enrichment-block">
                    <p className="enrichment-facts">
                      CVSS v3: <strong>{nvd.cvssV3 ? nvd.cvssV3.base : '—'}</strong>
                      {nvd.cvssV2 ? (
                        <>
                          {' · '}CVSS v2: <strong>{nvd.cvssV2.base}</strong>
                        </>
                      ) : null}
                    </p>
                    {nvd.cvssV3?.vector ? (
                      <p className="enrichment-vector">{nvd.cvssV3.vector}</p>
                    ) : null}
                    {nvd.cvssV2?.vector ? (
                      <p className="enrichment-vector">{nvd.cvssV2.vector}</p>
                    ) : null}
                    {nvd.description ? <p className="enrichment-body">{nvd.description}</p> : null}
                    {nvd.lastModifiedAt ? (
                      <p className="enrichment-meta">
                        Modified {formatEnrichmentDate(nvd.lastModifiedAt)}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <em>NVD record unavailable</em>
                )}
              </dd>
            </div>
            <div>
              <dt>CISA KEV</dt>
              <dd>
                {kev ? (
                  kev.listed ? (
                    <div className="enrichment-block">
                      <p className="enrichment-facts">
                        <strong>Listed</strong>
                      </p>
                      {kev.shortDescription ? (
                        <p className="enrichment-body">{kev.shortDescription}</p>
                      ) : null}
                      <p className="enrichment-meta">
                        Added {kev.dateAdded ?? '—'}
                        {' · '}Due {kev.dueDate ?? '—'}
                      </p>
                    </div>
                  ) : (
                    <div className="enrichment-block">
                      <p className="enrichment-facts">Not in KEV</p>
                    </div>
                  )
                ) : (
                  <em>KEV observation unavailable</em>
                )}
              </dd>
            </div>
            <div>
              <dt>EPSS</dt>
              <dd>
                {epss ? (
                  epss.score != null ? (
                    <div className="enrichment-block">
                      <p className="enrichment-facts">
                        Score: <strong>{epss.score.toFixed(4)}</strong>
                        {' · '}
                        Percentile:{' '}
                        <strong>{epss.percentile != null ? epss.percentile.toFixed(4) : '—'}</strong>
                      </p>
                      {epss.date ? (
                        <p className="enrichment-meta">Observed {epss.date}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="enrichment-block">
                      <p className="enrichment-facts">No EPSS score</p>
                    </div>
                  )
                ) : (
                  <em>EPSS observation unavailable</em>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="workspace-section">
          <h2 className="section-title">Linked articles</h2>
          {articles.length === 0 ? (
            <p className="empty-state">No linked articles yet.</p>
          ) : (
            <ul className="event-list">
              {articles.map((article) => (
                <li key={article.articleId} className="event-row">
                  <div>
                    <Link className="title" href={`/articles/${article.articleId}`}>
                      {article.title ?? article.canonicalUrl ?? `Article #${article.articleId}`}
                    </Link>
                    <div className="meta">
                      {article.sourceName ? <span>{article.sourceName}</span> : null}
                    </div>
                  </div>
                  <div className="meta" style={{ justifyContent: 'flex-end' }}>
                    <span>{formatWhen(article.publishedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
