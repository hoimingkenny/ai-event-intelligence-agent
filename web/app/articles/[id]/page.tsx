import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadArticleDetail } from '../../../../src/portal/articles-portal';
import { SiteHeader } from '../../../components/SiteHeader';
import { getDb } from '../../../lib/db';
import { excerpt, formatConfidence, formatWhen } from '../../../lib/format';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const article = await loadArticleDetail(getDb(), id);
  return {
    title: article?.title || 'Article',
  };
}

export default async function ArticleDetailPage({ params }: PageProps) {
  const { id } = await params;
  const article = await loadArticleDetail(getDb(), id);
  if (!article) notFound();

  const body = excerpt(article.cleanText ?? article.rssSummary);

  return (
    <>
      <SiteHeader active="articles" />
      <main className="page">
        <Link className="back-link" href="/articles">
          ← All articles
        </Link>
        <p className="page-kicker">Source article</p>
        <h1 className="page-title">{article.title || 'Untitled article'}</h1>

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
              <dt>Vendor</dt>
              <dd>
                {article.topVendor
                  ? `${article.topVendor} (${formatConfidence(article.vendorRelevance)})`
                  : '—'}
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

          {body ? <p className="detail-summary article-body">{body}</p> : null}

          <h2 className="page-kicker" style={{ marginBottom: '0.75rem' }}>
            Related events
          </h2>
          {article.events.length === 0 ? (
            <p className="page-lede" style={{ marginBottom: 0 }}>
              No approved events linked.
            </p>
          ) : (
            <ul className="sources">
              {article.events.map((event) => (
                <li key={event.eventId}>
                  <div>
                    <Link href={`/events/${event.eventId}`}>
                      {event.eventTitle || `Event ${event.eventId}`}
                    </Link>
                    {event.severity ? (
                      <>
                        {' '}
                        <span className={`chip ${event.severity.toLowerCase()}`}>{event.severity}</span>
                      </>
                    ) : null}
                  </div>
                  <div className="meta">
                    {event.relationship ? <span>{event.relationship}</span> : null}
                    <span>Confidence {formatConfidence(event.confidence)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
