import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '../../../components/SiteHeader';
import { getDb } from '../../../lib/db';
import { getPublicCveDetail } from '../../../../src/public/public-cve-read';
import { formatWhen } from '../../../lib/format';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

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
  const description = nvd?.description ?? null;
  const cvssText = nvd?.cvssV3
    ? `${nvd.cvssV3.base.toFixed(1)} (${nvd.cvssV3.vector})`
    : nvd?.cvssV2
      ? `${nvd.cvssV2.base.toFixed(1)} (${nvd.cvssV2.vector})`
      : null;

  return (
    <>
      <SiteHeader active="cves" />
      <main className="page">
        <p className="page-kicker">
          <Link href="/cves">← All CVEs</Link>
        </p>
        <h1 className="page-title">{cve.cveId}</h1>
        <p className="page-lede">
          Approved {formatWhen(cve.approvedAt)}
          {cve.approvedByActor ? ` by ${cve.approvedByActor}` : ''}
          {kev?.listed ? ' · listed in CISA KEV' : ''}
        </p>

        {description ? <p className="excerpt">{description}</p> : null}

        <section className="workspace-section">
          <h2 className="section-title">Authoritative enrichment</h2>
          <dl className="kv-grid">
            <dt>CVSS</dt>
            <dd>{cvssText ?? '—'}</dd>
            <dt>EPSS</dt>
            <dd>
              {epss?.score != null
                ? `${epss.score.toFixed(4)}${epss.percentile != null ? ` (percentile ${epss.percentile.toFixed(4)})` : ''}`
                : '—'}
            </dd>
            <dt>CISA KEV</dt>
            <dd>
              {kev?.listed
                ? `Listed · added ${kev.dateAdded ?? '—'} · due ${kev.dueDate ?? '—'}`
                : 'Not in KEV'}
            </dd>
            <dt>Last enriched</dt>
            <dd>{formatWhen(cve.lastEnrichedAt)}</dd>
          </dl>
        </section>

        <section className="workspace-section">
          <h2 className="section-title">Linked articles</h2>
          {articles.length === 0 ? (
            <p className="empty-state">No human-confirmed articles linked.</p>
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