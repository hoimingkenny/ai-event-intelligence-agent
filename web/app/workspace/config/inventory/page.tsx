import { redirect } from 'next/navigation';
import { listWorkspaceInventory } from '../../../../../src/workspace/workspace-config';
import { ConfigApplyNote, ConfigNav } from '../../../../components/ConfigNav';
import { ConfirmSubmitScript } from '../../../../components/ConfirmSubmitScript';
import { SiteHeader } from '../../../../components/SiteHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { getDb } from '../../../../lib/db';
import { requireAnalyst } from '../../../../lib/require-analyst';
import {
  createProductAction,
  setProductActiveAction,
  updateProductAction,
} from './actions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Inventory · Config · Workspace',
};

const ERROR_MESSAGES: Record<string, string> = {
  vendor_required: 'Vendor is required.',
  product_required: 'Product name is required.',
  invalid_criticality: 'Criticality must be one of critical, high, medium, low.',
  invalid_news_volume: 'News volume must be quiet or noisy.',
  vendor_not_found: 'Vendor not found.',
  product_not_found: 'Product not found.',
  duplicate_product: 'A product with this vendor + product name already exists.',
  empty_inventory: 'Cannot save a state with zero active monitored products. Activate another product first.',
};

const STATUS_MESSAGES: Record<string, string> = {
  saved: 'Product changes saved.',
  created: 'Product added.',
  deactivated: 'Product deactivated. Future filter runs will no longer match this product. Existing events are unaffected.',
  reactivated: 'Product reactivated.',
};

const DEACTIVATE_CONFIRM =
  'Future filter runs will no longer match this product. Existing events are unaffected. Continue?';

type PageProps = {
  searchParams: Promise<{ status?: string; error?: string }>;
};

export default async function WorkspaceConfigInventoryPage({ searchParams }: PageProps) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? '/login?callbackUrl=/workspace/config/inventory'
        : '/auth/denied'
    );
  }

  const params = await searchParams;
  const items = await listWorkspaceInventory(getDb());
  const activeCount = items.filter((item) => item.isActive).length;
  const wouldEmptyAfterEdit = activeCount === 1;

  const notice = params.error
    ? ERROR_MESSAGES[params.error] ?? `Save rejected (${params.error}).`
    : params.status && !params.error
      ? STATUS_MESSAGES[params.status] ?? null
      : null;

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Workspace Config</p>
        <h1 className="page-title">Inventory</h1>
        <p className="page-lede">
          Monitored vendor products from Postgres. “Active” is product-level (vendor
          must also be active to appear). Save does not start pipeline stages;
          changes take effect on the next pipeline run.
        </p>

        <WorkspaceNav active="config" />
        <ConfigNav active="inventory" />
        <ConfigApplyNote />

        {notice ? (
          <p className="flash" role="status">
            {notice}
          </p>
        ) : null}

        {activeCount === 0 ? (
          <div className="flash" role="status">
            <strong>0 active monitored products.</strong> Add a product below and save it as
            active, or activate an existing product.
          </div>
        ) : null}

        <ConfirmSubmitScript />

        <section className="workspace-section">
          <h2 className="section-title">Add monitored product</h2>
          <div className="detail-panel">
            <form action={createProductAction} className="edit-form">
              <div className="field-row">
                <label className="field">
                  <span>Vendor</span>
                  <input name="vendor" required placeholder="e.g. Okta" />
                </label>
                <label className="field">
                  <span>Product</span>
                  <input name="product" required placeholder="e.g. Workforce Identity" />
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Criticality</span>
                  <select name="criticality" defaultValue="high" required>
                    <option value="critical">critical</option>
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                  </select>
                </label>
                <label className="field">
                  <span>News volume</span>
                  <select name="newsVolume" defaultValue="quiet" required>
                    <option value="quiet">quiet</option>
                    <option value="noisy">noisy</option>
                  </select>
                </label>
              </div>

              <label className="field">
                <span>Aliases (comma-separated)</span>
                <input name="aliases" placeholder="Okta, Okta Workforce" />
              </label>

              <label
                className="field"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <input type="checkbox" name="isActive" value="true" defaultChecked />
                <span
                  style={{
                    textTransform: 'none',
                    letterSpacing: 0,
                    fontWeight: 500,
                    color: 'var(--ink)',
                  }}
                >
                  Active (product will be matched in filter/entity stages)
                </span>
              </label>

              <div className="form-actions">
                <button className="auth-button" type="submit">
                  Add product
                </button>
              </div>
            </form>
          </div>
        </section>

        <section className="workspace-section">
          <h2 className="section-title">Monitored products</h2>
          {items.length === 0 ? (
            <div className="empty-state">
              <h2>No monitored products yet</h2>
              <p>Add a product using the form above.</p>
            </div>
          ) : (
            <ul className="config-product-list">
              {items.map((item) => (
                <li key={item.id} className={`config-product-card ${item.isActive ? '' : 'inactive'}`}>
                  <header className="config-product-head">
                    <div>
                      <h3>{item.product}</h3>
                      <p className="meta">
                        <span>{item.vendor}</span>
                        <span className={`chip ${item.criticality}`}>{item.criticality}</span>
                        <span className="chip">{item.newsVolume}</span>
                        {item.isActive ? (
                          <span className="chip status-approved">active</span>
                        ) : (
                          <span className="chip status-draft">inactive</span>
                        )}
                      </p>
                      {item.aliases.length > 0 ? (
                        <p className="config-product-aliases">
                          Aliases: <code>{item.aliases.join(', ')}</code>
                        </p>
                      ) : null}
                    </div>
                    <ActiveToggle
                      productId={item.id}
                      isActive={item.isActive}
                      wouldEmpty={wouldEmptyAfterEdit}
                    />
                  </header>

                  <details className="config-product-edit">
                    <summary>Edit product</summary>
                    <form action={updateProductAction} className="edit-form">
                      <input type="hidden" name="productId" value={item.id} />
                      <label className="field">
                        <span>Product name</span>
                        <input name="product" defaultValue={item.product} required />
                      </label>
                      <div className="field-row">
                        <label className="field">
                          <span>Criticality</span>
                          <select name="criticality" defaultValue={item.criticality} required>
                            <option value="critical">critical</option>
                            <option value="high">high</option>
                            <option value="medium">medium</option>
                            <option value="low">low</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>News volume</span>
                          <select name="newsVolume" defaultValue={item.newsVolume} required>
                            <option value="quiet">quiet</option>
                            <option value="noisy">noisy</option>
                          </select>
                        </label>
                      </div>
                      <label className="field">
                        <span>Aliases (comma-separated)</span>
                        <input name="aliases" defaultValue={item.aliases.join(', ')} />
                      </label>
                      <div className="form-actions">
                        <button className="auth-button" type="submit">
                          Save changes
                        </button>
                      </div>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

function ActiveToggle({
  productId,
  isActive,
  wouldEmpty,
}: {
  productId: string;
  isActive: boolean;
  wouldEmpty: boolean;
}) {
  const intent = isActive ? 'deactivate' : 'activate';
  const buttonLabel = isActive ? 'Deactivate' : 'Reactivate';
  const warn = wouldEmpty && isActive;

  return (
    <form
      action={setProductActiveAction}
      data-confirm={isActive ? DEACTIVATE_CONFIRM : 'Reactivate this product for filter/entity stages?'}
      className="config-product-toggle"
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="intent" value={intent} />
      <button
        className={isActive ? 'auth-button secondary' : 'auth-button'}
        type="submit"
        title={warn ? 'This is the last active product. Server will reject the save.' : undefined}
      >
        {buttonLabel}
      </button>
      {warn ? (
        <span className="config-product-warn">last active product</span>
      ) : null}
    </form>
  );
}