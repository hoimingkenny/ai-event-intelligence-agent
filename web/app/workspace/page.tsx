import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCveMvpOverviewCounts } from '../../../src/workspace/cve-mvp-overview';
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
  const counts = await getCveMvpOverviewCounts(getDb());

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <div className="workspace-toolbar">
          <div>
            <p className="page-kicker">Analyst workspace</p>
            <h1 className="page-title">Overview</h1>
            <p className="page-lede">
              Signed in as <strong>{login}</strong>. Review articles and CVE cases. Feeds and
              inventory live under <Link href="/workspace/config">Config</Link>.
            </p>
          </div>
          <div className="form-actions">
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
              <span className="workspace-hub-label">Articles</span>
              <span className="workspace-hub-count">{counts.articles}</span>
              <span className="meta">Ingested articles in the review queue</span>
            </Link>
          </li>
          <li>
            <Link href="/workspace/cves" className="workspace-hub-card">
              <span className="workspace-hub-label">CVE cases</span>
              <span className="workspace-hub-count">{counts.cveCases}</span>
              <span className="meta">
                {counts.cveDraft} draft · {counts.cveApproved} approved
              </span>
            </Link>
          </li>
        </ul>
      </main>
    </>
  );
}
