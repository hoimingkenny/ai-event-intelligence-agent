import Link from 'next/link';
import type { ReactNode } from 'react';
import type { WorkspaceEventListItem } from '../../src/events/event-editorial';
import { formatWhen } from '../lib/format';

export function WorkspaceEventList({
  events,
  emptyTitle = 'No events in this queue',
  emptyBody,
}: {
  events: WorkspaceEventListItem[];
  emptyTitle?: string;
  emptyBody?: ReactNode;
}) {
  if (events.length === 0) {
    return (
      <div className="empty-state">
        <h2>{emptyTitle}</h2>
        <p>
          {emptyBody ?? (
            <>
              Pipeline drafts and analyst-created events appear here. You can also{' '}
              <Link href="/workspace/new">create an event from articles</Link>.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <ul className="event-list">
      {events.map((event) => (
        <li key={event.id} className="event-row">
          <div>
            <Link className="title" href={`/workspace/events/${event.id}`}>
              {event.eventTitle || 'Untitled event'}
            </Link>
            <div className="meta">
              <span className={`chip status-${event.publicationStatus}`}>
                {event.publicationStatus}
              </span>
              {event.severity ? (
                <span className={`chip ${event.severity.toLowerCase()}`}>{event.severity}</span>
              ) : null}
              <span>
                {event.sourceCount} source{event.sourceCount === 1 ? '' : 's'}
              </span>
              {event.affectedVendors && event.affectedVendors.length > 0 ? (
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
  );
}
