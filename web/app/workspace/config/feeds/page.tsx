import { redirect } from 'next/navigation';
import { listWorkspaceFeeds } from '../../../../../src/workspace/workspace-config';
import { ConfigApplyNote, ConfigNav } from '../../../../components/ConfigNav';
import { SiteHeader } from '../../../../components/SiteHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { getDb } from '../../../../lib/db';
import { formatWhen } from '../../../../lib/format';
import { requireAnalyst } from '../../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Feeds · Config · Workspace',
};

export default async function WorkspaceConfigFeedsPage() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace/config/feeds' : '/auth/denied'
    );
  }

  const feeds = await listWorkspaceFeeds(getDb());

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Workspace Config</p>
        <h1 className="page-title">Feeds</h1>
        <p className="page-lede">All configured RSS sources, including inactive. Read-only in this release.</p>

        <WorkspaceNav active="config" />
        <ConfigNav active="feeds" />
        <ConfigApplyNote />

        {feeds.length === 0 ? (
          <div className="empty-state">
            <h2>No feeds yet</h2>
            <p>Seed feeds into Postgres, then refresh this page.</p>
          </div>
        ) : (
          <div className="config-table-wrap">
            <table className="config-table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">URL</th>
                  <th scope="col">Type</th>
                  <th scope="col">Trust</th>
                  <th scope="col">Active</th>
                  <th scope="col">Last fetched</th>
                </tr>
              </thead>
              <tbody>
                {feeds.map((feed) => (
                  <tr key={feed.id} className={feed.isActive ? undefined : 'inactive'}>
                    <td>{feed.sourceName}</td>
                    <td className="config-url">
                      <a href={feed.feedUrl} target="_blank" rel="noreferrer">
                        {feed.feedUrl}
                      </a>
                    </td>
                    <td>{feed.sourceType ?? '—'}</td>
                    <td>{feed.trustLevel}</td>
                    <td>{feed.isActive ? 'yes' : 'no'}</td>
                    <td>{formatWhen(feed.lastFetchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
