import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listArticlesNeedingTriage } from '../../../../src/events/event-editorial';
import { createEventFromArticlesAction } from '../../actions/events';
import { SiteHeader } from '../../../components/SiteHeader';
import { getDb } from '../../../lib/db';
import { formatWhen } from '../../../lib/format';
import { requireAnalyst } from '../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Create event',
};

export default async function WorkspaceCreateEventPage() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace/new' : '/auth/denied');
  }

  const triage = await listArticlesNeedingTriage(getDb(), { limit: 80 });

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <Link className="back-link" href="/workspace">
          ← Workspace queue
        </Link>
        <p className="page-kicker">Analyst workspace</p>
        <h1 className="page-title">Create event</h1>
        <p className="page-lede">
          Select one or more articles that are not yet on an approved event. The new canonical event
          starts as <span className="chip status-draft">draft</span> — approve it separately when
          ready for the public catalogue.
        </p>

        {triage.length === 0 ? (
          <div className="empty-state">
            <h2>Nothing to triage</h2>
            <p>Every article is already on at least one approved event, or the database is empty.</p>
          </div>
        ) : (
          <div className="detail-panel">
            <form action={createEventFromArticlesAction} className="edit-form">
              <label className="field">
                <span>Title (optional — defaults to first selected article)</span>
                <input name="eventTitle" placeholder="Canonical event title" />
              </label>
              <label className="field">
                <span>Summary (optional)</span>
                <textarea name="eventSummary" rows={4} />
              </label>

              <fieldset className="article-picker">
                <legend>Articles</legend>
                <ul className="article-picker-list">
                  {triage.map((article) => (
                    <li key={article.id}>
                      <label className="article-picker-item">
                        <input type="checkbox" name="articleIds" value={article.id} />
                        <span>
                          <strong>{article.title || 'Untitled article'}</strong>
                          <span className="meta">
                            <span>{article.sourceName || 'Unknown source'}</span>
                            <span>#{article.id}</span>
                            <span>{formatWhen(article.publishedAt)}</span>
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>

              <div className="form-actions">
                <button className="auth-button" type="submit">
                  Create draft event
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </>
  );
}
