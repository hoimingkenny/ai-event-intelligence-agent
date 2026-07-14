import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listWorkspaceEvents } from '../../../src/events/event-editorial';
import { SiteHeader } from '../../components/SiteHeader';
import { getDb } from '../../lib/db';
import { formatWhen } from '../../lib/format';
import { requireAnalyst } from '../../lib/require-analyst';
import { signOutAction } from '../actions/auth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Workspace',
};

export default async function WorkspacePage() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace' : '/auth/denied');
  }

  const login = gate.session.user.githubLogin || gate.session.user.name || 'analyst';
  const events = await listWorkspaceEvents(getDb(), { limit: 100 });

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <div className="workspace-toolbar">
          <div>
            <p className="page-kicker">Analyst workspace</p>
            <h1 className="page-title">Events queue</h1>
            <p className="page-lede">
              Signed in as <strong>{login}</strong>. Draft and approved events both appear here —
              approve to publish, unpublish to hide from the public catalogue.
            </p>
          </div>
          <form action={signOutAction}>
            <button className="auth-button secondary" type="submit">
              Sign out
            </button>
          </form>
        </div>

        {events.length === 0 ? (
          <div className="empty-state">
            <h2>No events yet</h2>
            <p>
              Pipeline-created events will show up here as drafts. Create-from-scratch lands in a
              later ticket.
            </p>
          </div>
        ) : (
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
        )}
      </main>
    </>
  );
}
