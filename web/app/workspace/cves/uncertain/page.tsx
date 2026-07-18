import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PromoteUncertainAction } from '../../../../components/UncertainRelationshipActions';
import { SiteHeader } from '../../../../components/SiteHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { getDb } from '../../../../lib/db';
import { requireAnalyst } from '../../../../lib/require-analyst';
import {
  listUncertainRelationshipQueue,
  type UncertainRelationshipEntry,
} from '../../../../../src/workspace/uncertain-review-read';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Workspace · Uncertain CVE relationships',
};

export default async function UncertainRelationshipQueuePage() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? '/login?callbackUrl=/workspace/cves/uncertain'
        : '/auth/denied'
    );
  }

  const queue = await listUncertainRelationshipQueue(getDb(), { limit: 100 });

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <WorkspaceNav active="cves-uncertain" />
        <div className="workspace-toolbar">
          <div>
            <p className="page-kicker">Analyst workspace</p>
            <h1 className="page-title">Uncertain CVE relationships</h1>
            <p className="page-lede">
              Article–CVE pairs the automated relevance assessment marked uncertain. No CVE case
              exists yet — promoting a pair to relevant creates the case and starts enrichment.
            </p>
          </div>
        </div>

        {queue.length === 0 ? (
          <p className="empty-state">No uncertain relationships awaiting review.</p>
        ) : (
          <table className="workspace-table">
            <thead>
              <tr>
                <th>CVE</th>
                <th>Article</th>
                <th>Source</th>
                <th>Automated evidence</th>
                <th>Assessed</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((row) => (
                <UncertainRow key={`${row.articleId}:${row.cveId}`} entry={row} />
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}

function UncertainRow({ entry }: { entry: UncertainRelationshipEntry }) {
  return (
    <tr>
      <td>{entry.cveId}</td>
      <td>
        <Link href={`/workspace/articles/${entry.articleId}`}>
          {entry.article.title ?? entry.articleId}
        </Link>
      </td>
      <td>{entry.article.sourceName ?? '—'}</td>
      <td>{entry.evidence}</td>
      <td>{entry.automatedAt ?? '—'}</td>
      <td>
        <PromoteUncertainAction articleId={entry.articleId} cveId={entry.cveId} />
      </td>
    </tr>
  );
}
