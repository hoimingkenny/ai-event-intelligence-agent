import { redirect } from 'next/navigation';
import { listWorkspaceInventory } from '../../../../../src/workspace/workspace-config';
import { ConfigApplyNote, ConfigNav } from '../../../../components/ConfigNav';
import { SiteHeader } from '../../../../components/SiteHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { getDb } from '../../../../lib/db';
import { requireAnalyst } from '../../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Inventory · Config · Workspace',
};

export default async function WorkspaceConfigInventoryPage() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? '/login?callbackUrl=/workspace/config/inventory'
        : '/auth/denied'
    );
  }

  const items = await listWorkspaceInventory(getDb());

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Workspace Config</p>
        <h1 className="page-title">Inventory</h1>
        <p className="page-lede">
          Monitored vendor products from Postgres (current schema). “Vendor active” is
          vendor-level today; news volume and product-level active land later. Read-only in
          this release.
        </p>

        <WorkspaceNav active="config" />
        <ConfigNav active="inventory" />
        <ConfigApplyNote />

        {items.length === 0 ? (
          <div className="empty-state">
            <h2>No monitored products yet</h2>
            <p>Seed vendor products into Postgres, then refresh this page.</p>
          </div>
        ) : (
          <div className="config-table-wrap">
            <table className="config-table">
              <thead>
                <tr>
                  <th scope="col">Vendor</th>
                  <th scope="col">Product</th>
                  <th scope="col">Aliases</th>
                  <th scope="col">Criticality</th>
                  <th scope="col">Vendor active</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={item.isActive ? undefined : 'inactive'}>
                    <td>{item.vendor}</td>
                    <td>{item.product}</td>
                    <td>{item.aliases.length > 0 ? item.aliases.join(', ') : '—'}</td>
                    <td>{item.criticality}</td>
                    <td>{item.isActive ? 'yes' : 'no'}</td>
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
