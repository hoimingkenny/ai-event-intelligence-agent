import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '../../../components/SiteHeader';
import { WorkspaceNav } from '../../../components/WorkspaceNav';
import { getDb } from '../../../lib/db';
import { requireAnalyst } from '../../../lib/require-analyst';
import { listCveCasesForWorkspace, type CveListEntry } from '../../../../src/workspace/cve-case-workspace-read';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Workspace · CVEs',
};

export default async function WorkspaceCveListPage() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace/cves' : '/auth/denied');
  }

  const cases = await listCveCasesForWorkspace(getDb(), { limit: 100 });

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <WorkspaceNav active="cves" />
        <div className="workspace-toolbar">
          <div>
            <p className="page-kicker">Analyst workspace</p>
            <h1 className="page-title">CVE cases</h1>
            <p className="page-lede">
              Draft CVE cases ordered by the deterministic Attention order
              (KEV → active exploitation → EPSS → CVSS → recency → CVE id).
            </p>
          </div>
        </div>

        {cases.length === 0 ? (
          <p className="empty-state">No draft CVE cases yet.</p>
        ) : (
          <table className="workspace-table">
            <thead>
              <tr>
                <th>CVE</th>
                <th>KEV</th>
                <th>EPSS</th>
                <th>CVSS v3</th>
                <th>Active exploit</th>
                <th>Unresolved</th>
                <th>Last enriched</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((row) => (
                <CveListRow key={row.caseId} entry={row} />
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}

function CveListRow({ entry }: { entry: CveListEntry }) {
  return (
    <tr>
      <td>
        <Link href={`/workspace/cves/${entry.caseId}`}>{entry.cveId}</Link>
      </td>
      <td>{entry.signals.kevListed ? 'listed' : '—'}</td>
      <td>{entry.signals.epssScore != null ? entry.signals.epssScore.toFixed(4) : '—'}</td>
      <td>{entry.signals.cvssV3Base != null ? entry.signals.cvssV3Base.toFixed(1) : '—'}</td>
      <td>{entry.signals.activeExploitationEvidence ? 'yes' : '—'}</td>
      <td>{entry.unresolvedStates.length === 0 ? '—' : entry.unresolvedStates.join(', ')}</td>
      <td>{entry.lastEnrichedAt ? entry.lastEnrichedAt.toISOString() : '—'}</td>
      <td>{entry.status}</td>
    </tr>
  );
}
