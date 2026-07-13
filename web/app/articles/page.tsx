import Link from 'next/link';
import { loadArticlesOverview } from '../../../src/portal/articles-portal';
import { SiteHeader } from '../../components/SiteHeader';
import { getDb } from '../../lib/db';
import { formatConfidence, formatWhen } from '../../lib/format';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Articles',
};

export default async function ArticlesPage() {
  const overview = await loadArticlesOverview(getDb(), { limit: 50, sort: 'recent' });

  return (
    <>
      <SiteHeader active="articles" />
      <main className="page">
        <p className="page-kicker">Public catalogue</p>
        <h1 className="page-title">Articles</h1>
        <p className="page-lede">
          Source reports attached to at least one approved event. Draft-only pipeline articles stay
          private.
        </p>

        {overview.items.length === 0 ? (
          <div className="empty-state">
            <h2>No public articles yet</h2>
            <p>
              Articles appear here once they belong to an approved canonical event. Until then the
              feed stays empty.
            </p>
          </div>
        ) : (
          <ul className="event-list">
            {overview.items.map((article) => (
              <li key={article.id} className="event-row">
                <div>
                  <Link className="title" href={`/articles/${article.id}`}>
                    {article.title || 'Untitled article'}
                  </Link>
                  <div className="meta">
                    <span>{article.sourceName || 'Unknown source'}</span>
                    {article.topVendor ? <span>{article.topVendor}</span> : null}
                    {article.vendorRelevance !== null ? (
                      <span>Relevance {formatConfidence(article.vendorRelevance)}</span>
                    ) : null}
                  </div>
                </div>
                <div className="meta" style={{ justifyContent: 'flex-end' }}>
                  <span>{formatWhen(article.publishedAt ?? article.fetchedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
