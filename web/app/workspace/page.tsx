import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  listArticlesNeedingTriage,
  listWorkspaceEvents,
} from '../../../src/events/event-editorial';
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
  const db = getDb();
  const [events, triage] = await Promise.all([
    listWorkspaceEvents(db, { limit: 100 }),
    listArticlesNeedingTriage(db, { limit: 12 }),
  ]);

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
          <div className="form-actions">
            <Link className="auth-button" href="/workspace/new">
              Create event
            </Link>
            <form action={signOutAction}>
              <button className="auth-button secondary" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>

        <section className="workspace-section">
          <div className="section-head">
            <h2 className="section-title">Needs triage</h2>
            <Link href="/workspace/new">Open create flow</Link>
          </div>
          <p className="page-lede" style={{ marginBottom: '1rem' }}>
            Articles not yet on any approved event. Create a draft event from one or more of them,
            or attach them from an event detail page.
          </p>
          {triage.length === 0 ? (
            <p className="meta">No untriaged articles right now.</p>
          ) : (
            <ul className="sources">
              {triage.map((article) => (
                <li key={article.id}>
                  <div className="when">{formatWhen(article.publishedAt)}</div>
                  <div>
                    <strong>{article.sourceName || 'Unknown source'}</strong>
                    <span className="meta" style={{ marginLeft: '0.75rem' }}>
                      #{article.id}
                    </span>
                  </div>
                  <div>{article.title || article.canonicalUrl || 'Untitled article'}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="workspace-section">
          <h2 className="section-title">Events</h2>
          {events.length === 0 ? (
            <div className="empty-state">
              <h2>No events yet</h2>
              <p>
                Pipeline-created drafts appear here, or{' '}
                <Link href="/workspace/new">create an event from articles</Link>.
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
        </section>
      </main>
    </>
  );
}
