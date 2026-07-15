import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getWorkspaceQueueCounts } from '../../../src/events/event-editorial';
import { SiteHeader } from '../../components/SiteHeader';
import { WorkspaceNav } from '../../components/WorkspaceNav';
import { getDb } from '../../lib/db';
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
  const counts = await getWorkspaceQueueCounts(getDb());

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <div className="workspace-toolbar">
          <div>
            <p className="page-kicker">Analyst workspace</p>
            <h1 className="page-title">Overview</h1>
            <p className="page-lede">
              Signed in as <strong>{login}</strong>. Open a queue to triage articles, review drafts,
              or manage approved events. Ops settings live under{' '}
              <Link href="/workspace/config">Config</Link>.
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

        <WorkspaceNav active="overview" />

        <ul className="workspace-hub">
          <li>
            <Link href="/workspace/triage" className="workspace-hub-card">
              <span className="workspace-hub-label">Needs triage</span>
              <span className="workspace-hub-count">{counts.triage}</span>
              <span className="meta">Articles not yet on an approved event</span>
            </Link>
          </li>
          <li>
            <Link href="/workspace/drafts" className="workspace-hub-card">
              <span className="workspace-hub-label">Draft events</span>
              <span className="workspace-hub-count">{counts.drafts}</span>
              <span className="meta">Edit and approve before publishing</span>
            </Link>
          </li>
          <li>
            <Link href="/workspace/approved" className="workspace-hub-card">
              <span className="workspace-hub-label">Approved events</span>
              <span className="workspace-hub-count">{counts.approved}</span>
              <span className="meta">Live on the public catalogue — unpublish to hide</span>
            </Link>
          </li>
        </ul>
      </main>
    </>
  );
}
