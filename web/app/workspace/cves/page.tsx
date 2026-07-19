import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '../../../components/SiteHeader';
import { WorkspaceNav } from '../../../components/WorkspaceNav';
import { getDb } from '../../../lib/db';
import { formatWhen } from '../../../lib/format';
import { requireAnalyst } from '../../../lib/require-analyst';
import {
  listCveCasesForWorkspace,
  type CveListEntry,
} from '../../../../src/workspace/cve-case-workspace-read';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Workspace · CVEs',
};

export default async function WorkspaceCveListPage() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace/cves' : '/auth/denied'
    );
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
              Draft CVE cases ordered by Attention (KEV → active exploitation → EPSS → CVSS →
              recency → CVE id).
            </p>
          </div>
        </div>

        {cases.length === 0 ? (
          <p className="empty-state">No draft CVE cases yet.</p>
        ) : (
          <div className="workspace-table-wrap">
            <table className="workspace-table">
              <thead>
                <tr>
                  <th scope="col">CVE</th>
                  <th scope="col">Signals</th>
                  <th scope="col" className="workspace-table-num">
                    EPSS
                  </th>
                  <th scope="col" className="workspace-table-num">
                    CVSS
                  </th>
                  <th scope="col">Unresolved</th>
                  <th scope="col">Enriched</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((row) => (
                  <CveListRow key={row.caseId} entry={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

function CveListRow({ entry }: { entry: CveListEntry }) {
  const { signals } = entry;
  const rowClass = [
    signals.kevListed ? 'workspace-table-row-priority' : null,
    signals.activeExploitationEvidence ? 'workspace-table-row-hot' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <tr className={rowClass || undefined}>
      <td>
        <Link className="workspace-table-cve" href={`/workspace/cves/${entry.caseId}`}>
          {entry.cveId}
        </Link>
      </td>
      <td>
        <span className="workspace-signal-row">
          <span
            className={signals.kevListed ? 'workspace-signal on' : 'workspace-signal'}
            title={signals.kevListed ? 'Listed in CISA KEV' : 'Not in CISA KEV'}
          >
            KEV
          </span>
          <span
            className={
              signals.activeExploitationEvidence ? 'workspace-signal on warn' : 'workspace-signal'
            }
            title={
              signals.activeExploitationEvidence
                ? 'Active exploitation signal on a linked article'
                : 'No active exploitation signal'
            }
          >
            Exploit
          </span>
        </span>
      </td>
      <td className="workspace-table-num">
        {signals.epssScore != null ? signals.epssScore.toFixed(4) : '—'}
      </td>
      <td className="workspace-table-num">
        {signals.cvssV3Base != null ? signals.cvssV3Base.toFixed(1) : '—'}
      </td>
      <td>
        {entry.unresolvedStates.length === 0 ? (
          <span className="meta">—</span>
        ) : (
          <span className="workspace-signal on warn" title={entry.unresolvedStates.join(', ')}>
            {entry.unresolvedStates.length}
          </span>
        )}
      </td>
      <td>
        <time
          className="workspace-table-when"
          dateTime={entry.lastEnrichedAt ? entry.lastEnrichedAt.toISOString() : undefined}
        >
          {formatWhen(entry.lastEnrichedAt)}
        </time>
      </td>
      <td>
        <span className={`workspace-status status-${entry.status}`}>{entry.status}</span>
      </td>
    </tr>
  );
}
