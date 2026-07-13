import Link from 'next/link';
import { loadEventsOverview } from '../../../src/portal/events-portal.js';
import { SiteHeader } from '../../components/SiteHeader';
import { getDb } from '../../lib/db';
import { formatConfidence, formatWhen } from '../../lib/format';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Events',
};

export default async function EventsPage() {
  const overview = await loadEventsOverview(getDb(), { limit: 50, sort: 'recent' });

  return (
    <>
      <SiteHeader />
      <main className="page">
        <p className="page-kicker">Public catalogue</p>
        <h1 className="page-title">Events</h1>
        <p className="page-lede">
          Approved canonical incidents only. Draft pipeline output stays private until an analyst
          publishes it.
        </p>

        {overview.items.length === 0 ? (
          <div className="empty-state">
            <h2>No approved events yet</h2>
            <p>
              The catalogue is empty until the first incident is approved. Check back as analysts
              review the pipeline queue.
            </p>
          </div>
        ) : (
          <ul className="event-list">
            {overview.items.map((event) => (
              <li key={event.id} className="event-row">
                <div>
                  <Link className="title" href={`/events/${event.id}`}>
                    {event.eventTitle || 'Untitled event'}
                  </Link>
                  <div className="meta">
                    {event.severity ? (
                      <span className={`chip ${event.severity.toLowerCase()}`}>{event.severity}</span>
                    ) : null}
                    <span>{event.sourceCount} source{event.sourceCount === 1 ? '' : 's'}</span>
                    <span>Confidence {formatConfidence(event.confidence)}</span>
                    {event.affectedVendors.length > 0 ? (
                      <span>{event.affectedVendors.join(', ')}</span>
                    ) : null}
                  </div>
                </div>
                <div className="meta" style={{ justifyContent: 'flex-end' }}>
                  <span>{formatWhen(event.lastSeenAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
