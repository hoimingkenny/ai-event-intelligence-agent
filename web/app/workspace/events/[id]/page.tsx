import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getWorkspaceEvent,
  listArticlesNeedingTriage,
  listWorkspaceEventArticles,
  listWorkspaceEvents,
} from '../../../../../src/events/event-editorial';
import {
  approveEventAction,
  attachArticleAction,
  detachArticleAction,
  moveArticleAction,
  saveEventFieldsAction,
  unpublishEventAction,
} from '../../../actions/events';
import { SiteHeader } from '../../../../components/SiteHeader';
import { getDb } from '../../../../lib/db';
import { formatWhen } from '../../../../lib/format';
import { requireAnalyst } from '../../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    approved?: string;
    unpublished?: string;
    created?: string;
    attached?: string;
    detached?: string;
    moved?: string;
  }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const event = await getWorkspaceEvent(getDb(), id);
  return {
    title: event ? `Edit · ${event.eventTitle}` : 'Edit event',
  };
}

export default async function WorkspaceEventPage({ params, searchParams }: PageProps) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace' : '/auth/denied');
  }

  const { id } = await params;
  const notices = await searchParams;
  const db = getDb();
  const event = await getWorkspaceEvent(db, id);
  if (!event) notFound();

  const [members, triage, allEvents] = await Promise.all([
    listWorkspaceEventArticles(db, id),
    listArticlesNeedingTriage(db, { limit: 40 }),
    listWorkspaceEvents(db, { limit: 100 }),
  ]);

  const memberIds = new Set(members.map((article) => article.id));
  const attachCandidates = triage.filter((article) => !memberIds.has(article.id));
  const moveTargets = allEvents.filter((item) => item.id !== event.id);
  const isApproved = event.publicationStatus === 'approved';

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <Link className="back-link" href="/workspace">
          ← Workspace queue
        </Link>
        <p className="page-kicker">Edit event</p>
        <h1 className="page-title">{event.eventTitle || 'Untitled event'}</h1>
        <p className="page-lede">
          Publication status:{' '}
          <span className={`chip status-${event.publicationStatus}`}>{event.publicationStatus}</span>
          {isApproved ? (
            <>
              {' '}
              ·{' '}
              <Link href={`/events/${event.id}`} target="_blank">
                View public page
              </Link>
            </>
          ) : null}
        </p>

        {notices.saved ? <p className="flash">Fields saved.</p> : null}
        {notices.created ? <p className="flash">Draft event created with selected articles.</p> : null}
        {notices.approved ? <p className="flash">Event approved — now visible on the public catalogue.</p> : null}
        {notices.unpublished ? (
          <p className="flash">Event unpublished — hidden from the public catalogue.</p>
        ) : null}
        {notices.attached ? <p className="flash">Article attached.</p> : null}
        {notices.detached ? <p className="flash">Article detached.</p> : null}
        {notices.moved ? <p className="flash">Article moved to this event.</p> : null}

        <div className="detail-panel">
          <form action={saveEventFieldsAction} className="edit-form">
            <input type="hidden" name="eventId" value={event.id} />

            <label className="field">
              <span>Title</span>
              <input name="eventTitle" defaultValue={event.eventTitle ?? ''} required />
            </label>

            <label className="field">
              <span>Summary</span>
              <textarea name="eventSummary" rows={5} defaultValue={event.eventSummary ?? ''} />
            </label>

            <div className="field-row">
              <label className="field">
                <span>Severity</span>
                <select name="severity" defaultValue={event.severity ?? ''}>
                  <option value="">—</option>
                  <option value="critical">critical</option>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
              </label>
              <label className="field">
                <span>Urgency</span>
                <input name="urgency" defaultValue={event.urgency ?? ''} placeholder="P0 / P1 / P2" />
              </label>
            </div>

            <label className="field">
              <span>Vendors (comma-separated)</span>
              <input
                name="affectedVendors"
                defaultValue={(event.affectedVendors ?? []).join(', ')}
              />
            </label>

            <label className="field">
              <span>Products (comma-separated)</span>
              <input
                name="affectedProducts"
                defaultValue={(event.affectedProducts ?? []).join(', ')}
              />
            </label>

            <label className="field">
              <span>CVEs (comma-separated)</span>
              <input name="cves" defaultValue={(event.cves ?? []).join(', ')} />
            </label>

            <label className="field">
              <span>Attack types (comma-separated)</span>
              <input name="attackTypes" defaultValue={(event.attackTypes ?? []).join(', ')} />
            </label>

            <div className="form-actions">
              <button className="auth-button" type="submit">
                Save fields
              </button>
            </div>
          </form>

          <div className="publication-actions">
            {isApproved ? (
              <form action={unpublishEventAction}>
                <input type="hidden" name="eventId" value={event.id} />
                <button className="auth-button secondary" type="submit">
                  Unpublish
                </button>
              </form>
            ) : (
              <form action={approveEventAction}>
                <input type="hidden" name="eventId" value={event.id} />
                <button className="auth-button" type="submit">
                  Approve for public catalogue
                </button>
              </form>
            )}
          </div>
        </div>

        <section className="workspace-section">
          <h2 className="section-title">Membership</h2>
          <p className="page-lede">
            Attach, detach, or move source articles. Merge/split of whole events stays out of scope.
          </p>

          {members.length === 0 ? (
            <p className="meta">No articles attached yet.</p>
          ) : (
            <ul className="sources membership-list">
              {members.map((article) => (
                <li key={article.id}>
                  <div className="when">{formatWhen(article.publishedAt)}</div>
                  <div>
                    <strong>{article.sourceName || 'Unknown source'}</strong>
                    <span className="meta" style={{ marginLeft: '0.75rem' }}>
                      #{article.id}
                    </span>
                  </div>
                  <div>{article.title || article.canonicalUrl || 'Untitled article'}</div>
                  <div className="membership-ops">
                    <form action={detachArticleAction}>
                      <input type="hidden" name="eventId" value={event.id} />
                      <input type="hidden" name="articleId" value={article.id} />
                      <button className="auth-button secondary" type="submit">
                        Detach
                      </button>
                    </form>
                    {moveTargets.length > 0 ? (
                      <form action={moveArticleAction} className="move-form">
                        <input type="hidden" name="fromEventId" value={event.id} />
                        <input type="hidden" name="articleId" value={article.id} />
                        <select name="toEventId" required defaultValue="">
                          <option value="" disabled>
                            Move to…
                          </option>
                          {moveTargets.map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.eventTitle || `Event #${target.id}`} ({target.publicationStatus})
                            </option>
                          ))}
                        </select>
                        <button className="auth-button secondary" type="submit">
                          Move
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="detail-panel" style={{ marginTop: '1.5rem' }}>
            <h3 className="page-kicker" style={{ marginBottom: '0.75rem' }}>
              Attach article
            </h3>
            {attachCandidates.length === 0 ? (
              <p className="meta" style={{ margin: 0 }}>
                No triage candidates left to attach (or they are already on this event).
              </p>
            ) : (
              <form action={attachArticleAction} className="edit-form">
                <input type="hidden" name="eventId" value={event.id} />
                <label className="field">
                  <span>Article not on an approved event</span>
                  <select name="articleId" required defaultValue="">
                    <option value="" disabled>
                      Select article…
                    </option>
                    {attachCandidates.map((article) => (
                      <option key={article.id} value={article.id}>
                        #{article.id} · {article.title || article.canonicalUrl || 'Untitled'}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-actions">
                  <button className="auth-button" type="submit">
                    Attach
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
