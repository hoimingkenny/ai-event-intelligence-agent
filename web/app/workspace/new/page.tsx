import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listArticlesNeedingTriagePage } from '../../../../src/events/event-editorial';
import { createEventFromArticlesAction } from '../../actions/events';
import { SiteHeader } from '../../../components/SiteHeader';
import { WorkspaceNav } from '../../../components/WorkspaceNav';
import { WorkspacePagination } from '../../../components/WorkspacePagination';
import { getDb } from '../../../lib/db';
import { formatWhen } from '../../../lib/format';
import { requireAnalyst } from '../../../lib/require-analyst';
import {
  WORKSPACE_PAGE_SIZE,
  parseWorkspacePage,
  workspacePageOffset,
} from '../../../lib/workspace-page';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Create event',
};

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function WorkspaceCreateEventPage({ searchParams }: PageProps) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace/new' : '/auth/denied');
  }

  const { page: pageRaw } = await searchParams;
  const page = parseWorkspacePage(pageRaw);
  const result = await listArticlesNeedingTriagePage(getDb(), {
    limit: WORKSPACE_PAGE_SIZE,
    offset: workspacePageOffset(page),
  });

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Analyst workspace</p>
        <h1 className="page-title">Create event</h1>
        <p className="page-lede">
          Select one or more articles on this page that are not yet on an approved event. The new
          canonical event starts as <span className="chip status-draft">draft</span> — approve it
          separately when ready for the public catalogue.
        </p>

        <WorkspaceNav active="new" />

        {result.total === 0 ? (
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
                <legend>Articles on this page</legend>
                <ul className="article-picker-list">
                  {result.items.map((article) => (
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
                <Link className="auth-button secondary" href="/workspace">
                  Cancel
                </Link>
              </div>
            </form>

            <WorkspacePagination
              basePath="/workspace/new"
              page={page}
              total={result.total}
              limit={result.limit}
            />
          </div>
        )}
      </main>
    </>
  );
}
