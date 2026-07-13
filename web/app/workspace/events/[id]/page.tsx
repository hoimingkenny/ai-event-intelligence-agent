import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getWorkspaceEvent } from '../../../../../src/events/event-editorial';
import {
  approveEventAction,
  saveEventFieldsAction,
  unpublishEventAction,
} from '../../../actions/events';
import { SiteHeader } from '../../../../components/SiteHeader';
import { getDb } from '../../../../lib/db';
import { requireAnalyst } from '../../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; approved?: string; unpublished?: string }>;
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
  const event = await getWorkspaceEvent(getDb(), id);
  if (!event) notFound();

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
        {notices.approved ? <p className="flash">Event approved — now visible on the public catalogue.</p> : null}
        {notices.unpublished ? (
          <p className="flash">Event unpublished — hidden from the public catalogue.</p>
        ) : null}

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
      </main>
    </>
  );
}
