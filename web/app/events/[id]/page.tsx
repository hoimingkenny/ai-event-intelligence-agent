import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventDetail } from '../../../../src/portal/events-portal';
import { SiteHeader } from '../../../components/SiteHeader';
import { getDb } from '../../../lib/db';
import { formatConfidence, formatWhen } from '../../../lib/format';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const event = await loadEventDetail(getDb(), id);
  return {
    title: event?.eventTitle || 'Event',
  };
}

export default async function EventDetailPage({ params }: PageProps) {
  const { id } = await params;
  const event = await loadEventDetail(getDb(), id);
  if (!event) notFound();

  return (
    <>
      <SiteHeader />
      <main className="page">
        <Link className="back-link" href="/events">
          ← All events
        </Link>
        <p className="page-kicker">Canonical event</p>
        <h1 className="page-title">{event.eventTitle || 'Untitled event'}</h1>

        <div className="detail-panel">
          {event.eventSummary ? <p className="detail-summary">{event.eventSummary}</p> : null}

          <dl className="kv-grid">
            <div>
              <dt>Severity</dt>
              <dd>
                {event.severity ? (
                  <span className={`chip ${event.severity.toLowerCase()}`}>{event.severity}</span>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Urgency</dt>
              <dd>{event.urgency || '—'}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{formatConfidence(event.confidence)}</dd>
            </div>
            <div>
              <dt>First seen</dt>
              <dd>{formatWhen(event.firstSeenAt)}</dd>
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>{formatWhen(event.lastSeenAt)}</dd>
            </div>
            <div>
              <dt>Vendors</dt>
              <dd>{event.affectedVendors.length ? event.affectedVendors.join(', ') : '—'}</dd>
            </div>
            <div>
              <dt>Products</dt>
              <dd>{event.affectedProducts.length ? event.affectedProducts.join(', ') : '—'}</dd>
            </div>
            <div>
              <dt>CVEs</dt>
              <dd>{event.cves.length ? event.cves.join(', ') : '—'}</dd>
            </div>
            <div>
              <dt>Attack types</dt>
              <dd>{event.attackTypes.length ? event.attackTypes.join(', ') : '—'}</dd>
            </div>
          </dl>

          <h2 className="page-kicker" style={{ marginBottom: '0.75rem' }}>
            Sources
          </h2>
          {event.sources.length === 0 ? (
            <p className="page-lede" style={{ marginBottom: 0 }}>
              No source articles attached.
            </p>
          ) : (
            <ul className="sources">
              {event.sources.map((source) => (
                <li key={source.articleId}>
                  <div className="when">{formatWhen(source.publishedAt ?? source.fetchedAt)}</div>
                  <div>
                    <strong>{source.sourceName || 'Unknown source'}</strong>
                    {source.isPrimarySource ? ' · primary' : ''}
                    {source.isMaterialUpdate ? ' · material update' : ''}
                  </div>
                  <div>
                    {source.canonicalUrl ? (
                      <a href={source.canonicalUrl} rel="noreferrer" target="_blank">
                        {source.title || source.canonicalUrl}
                      </a>
                    ) : (
                      source.title || 'Untitled article'
                    )}
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
