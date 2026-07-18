import Link from 'next/link';
import { SiteHeader } from '../../components/SiteHeader';
import { getDb } from '../../lib/db';
import { listPublicArticles } from '../../../src/public/public-cve-read';
import { formatWhen } from '../../lib/format';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Articles',
};

export default async function PublicArticlesPage() {
  const articles = await listPublicArticles(getDb());

  return (
    <>
      <SiteHeader active="articles" />
      <main className="page">
        <p className="page-kicker">Public catalogue</p>
        <h1 className="page-title">Articles</h1>
        <p className="page-lede">
          Source reports attached to at least one approved CVE with a human-confirmed link. Draft
          pipeline output stays private.
        </p>

        {articles.length === 0 ? (
          <div className="empty-state">
            <h2>No public articles yet</h2>
            <p>
              Articles appear here once an analyst confirms their link to an approved CVE. Until
              then the feed stays empty.
            </p>
          </div>
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
                    {article.cveIds.length > 0 ? (
                      <span>
                        Linked CVEs:{' '}
                        {article.cveIds.map((cveId, idx) => (
                          <span key={cveId}>
                            {idx > 0 ? ', ' : ''}
                            <Link href={`/cves/${encodeURIComponent(cveId)}`}>{cveId}</Link>
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="meta" style={{ justifyContent: 'flex-end' }}>
                  <span>{formatWhen(article.publishedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}