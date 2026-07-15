import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getWorkspaceConfigCounts } from '../../../../src/workspace/workspace-config';
import { ConfigApplyNote, ConfigNav } from '../../../components/ConfigNav';
import { SiteHeader } from '../../../components/SiteHeader';
import { WorkspaceNav } from '../../../components/WorkspaceNav';
import { getDb } from '../../../lib/db';
import { requireAnalyst } from '../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Config · Workspace',
};

export default async function WorkspaceConfigHubPage() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace/config' : '/auth/denied');
  }

  const counts = await getWorkspaceConfigCounts(getDb());

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Workspace Config</p>
        <h1 className="page-title">Config</h1>
        <p className="page-lede">
          Live feeds and monitored inventory from Postgres. Queues stay under Overview / Triage /
          Drafts / Approved.
        </p>

        <WorkspaceNav active="config" />
        <ConfigNav active="hub" />
        <ConfigApplyNote />

        <ul className="workspace-hub">
          <li>
            <Link href="/workspace/config/feeds" className="workspace-hub-card">
              <span className="workspace-hub-label">Feeds</span>
              <span className="workspace-hub-count">{counts.activeFeeds}</span>
              <span className="meta">Active RSS sources for ingest</span>
            </Link>
          </li>
          <li>
            <Link href="/workspace/config/inventory" className="workspace-hub-card">
              <span className="workspace-hub-label">Inventory</span>
              <span className="workspace-hub-count">{counts.activeProducts}</span>
              <span className="meta">Active monitored vendor products</span>
            </Link>
          </li>
        </ul>
      </main>
    </>
  );
}
