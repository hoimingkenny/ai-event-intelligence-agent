/**
 * Cheap-filter eval review workspace.
 *
 * The pane is composed from three independent exports so a parent shell can
 * inline it directly into one HTML document (no iframe, no postMessage):
 *
 *   - evalPaneStyles()      — CSS rules. The parent inlines into its <style>.
 *   - renderEvalPane()      — the pane's body markup, wrapped in
 *                             <section id="eval-pane" hidden>. The parent
 *                             toggles `hidden` to show/hide.
 *   - evalPaneBodyScript()  — a self-contained `initEvalPane(state, hooks)`
 *                             function. The parent calls it once after defining
 *                             the shared `state` object.
 *
 * The standalone server (tests + legacy fallback) keeps working via
 * renderEvalReviewApp() which composes the same pieces.
 */

const EVAL_CSS = `
    :root {
      --bg: #f7f8fa; --surface: #ffffff; --soft: #eef2f6; --line: #d8dee8;
      --text: #17202a; --muted: #5f6b7a; --accent: #0f766e; --accent-dark: #0b5d57;
      --warn: #9a5b00; --bad: #b42318; --good: #146c43;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-width: 100%; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { height: 60px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--line); background: var(--surface); }
    h1 { margin: 0; font-size: 18px; }
    h2 { margin: 0 0 10px; font-size: 15px; }
    h3 { margin: 12px 0 6px; font-size: 12px; color: var(--muted); text-transform: uppercase; }
    button, textarea, select { font: inherit; }
    button { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 7px 10px; cursor: pointer; }
    button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    button.primary:hover { background: var(--accent-dark); }
    .tabs { display: flex; gap: 6px; }
    .tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .layout { display: grid; grid-template-columns: 360px minmax(0, 1fr); width: 100%; min-width: 100%; min-height: calc(100vh - 60px); }
    .sidebar { border-right: 1px solid var(--line); background: var(--surface); min-width: 0; }
    .summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px; border-bottom: 1px solid var(--line); }
    .metric { border: 1px solid var(--line); border-radius: 6px; padding: 8px; background: #fbfcfd; }
    .metric strong { display: block; font-size: 20px; line-height: 1.1; }
    .item-list { max-height: calc(100vh - 170px); overflow: auto; }
    .item-button { width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 11px 12px; background: var(--surface); }
    .item-button.active { background: #e9f6f4; box-shadow: inset 3px 0 0 var(--accent); }
    .item-title { font-weight: 650; overflow-wrap: anywhere; }
    .muted { color: var(--muted); }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
    .badge { border: 1px solid var(--line); background: var(--soft); border-radius: 999px; padding: 1px 7px; font-size: 12px; }
    .badge.good { color: var(--good); background: #eef8f1; border-color: #b7dfc6; }
    .badge.warn { color: var(--warn); background: #fff8e8; border-color: #f2d29b; }
    .badge.bad { color: var(--bad); background: #fff1ef; border-color: #f5b5ae; }
    .content { padding: 16px; min-width: 0; }
    .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 12px; min-width: 0; }
    .kv { display: grid; grid-template-columns: 140px 1fr; gap: 6px; margin: 4px 0; }
    .kv span:first-child { color: var(--muted); }
    pre { margin: 0; max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: #fbfcfe; border: 1px solid var(--line); border-radius: 6px; padding: 10px; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    textarea { width: 100%; min-height: 80px; resize: vertical; border: 1px solid var(--line); border-radius: 6px; padding: 8px; }
    .label-buttons { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
    .label-buttons button { padding: 12px 6px; font-weight: 650; }
    .label-buttons button.selected { outline: 3px solid var(--accent); }
    .lbl-critical { background: #fff1ef; border-color: #f5b5ae; color: var(--bad); }
    .lbl-relevant { background: #fff8e8; border-color: #f2d29b; color: var(--warn); }
    .lbl-weak { background: #eef2f6; }
    .lbl-irrelevant { background: #eef8f1; border-color: #b7dfc6; color: var(--good); }
    .actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
    .empty { color: var(--muted); padding: 20px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; }
    th { background: var(--soft); }
    td.num, th.num { text-align: right; }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover { background: #f0f6f5; }
    .gate-banner { border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; border: 1px solid; }
    .gate-pass { background: #eef8f1; border-color: #b7dfc6; color: var(--good); }
    .gate-fail { background: #fff1ef; border-color: #f5b5ae; color: var(--bad); }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .inventory-content { width: 100%; max-width: none; }
    .inventory-table-wrap { width: 100%; overflow-x: auto; }
    .llm-layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); width: 100%; min-height: calc(100vh - 60px); }
    .llm-list { border-right: 1px solid var(--line); background: var(--surface); }
    .llm-run-button { width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 11px 12px; background: var(--surface); }
    .llm-run-button.active { background: #e9f6f4; box-shadow: inset 3px 0 0 var(--accent); }
    a { color: var(--accent); }
    @media (max-width: 980px) { .layout, .llm-layout { grid-template-columns: 1fr; } .item-list { max-height: 320px; } }
`;

const EVAL_PANE_HTML = `
  <section id="eval-pane" hidden>
    <header style="height:auto;padding:10px 18px">
      <div class="tabs" role="tablist" aria-label="Eval view">
        <button id="eval-tab-label" class="active" type="button">Label candidates</button>
        <button id="eval-tab-live" type="button">Live decisions</button>
        <button id="eval-tab-report" type="button">Report</button>
        <button id="eval-tab-llm" type="button">LLM evaluation</button>
        <button id="eval-tab-inventory" type="button">Inventory</button>
        <button id="eval-refresh" type="button">Refresh</button>
      </div>
    </header>
    <div id="inventory-view" style="display:none">
      <div class="content inventory-content">
        <section class="panel">
          <h2>Monitored vendor inventory</h2>
          <p class="muted">The filter, report, and live tabs use changes immediately. Edit rows inline, or append new products by pasting JSON below.</p>
          <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">
            <input id="inventory-search" type="search" placeholder="Search vendor or product..." style="flex:1;max-width:320px;border:1px solid var(--line);border-radius:6px;padding:7px 10px">
            <select id="inventory-crit">
              <option value="ALL" selected>All criticalities</option>
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
            <span id="inventory-count" class="muted"></span>
          </div>
          <div id="inventory-table" class="inventory-table-wrap"></div>
          <div class="actions" style="margin-top:8px">
            <span></span>
            <span id="inventory-status" class="muted"></span>
          </div>
        </section>
        <section class="panel">
          <h2>Add vendor products (paste JSON)</h2>
          <p class="muted">Paste one object or an array (e.g. generated by an LLM) — it is <strong>appended</strong> to the table above. <code>id</code> is optional (derived from vendor + product). Duplicate vendor+product pairs are rejected.</p>
          <textarea id="inventory-add" spellcheck="false" placeholder='[{"vendor": "Okta", "product": "Workforce Identity Cloud", "aliases": ["Okta WIC"], "criticality": "high", "inProduction": true, "newsVolume": "quiet"}]' style="min-height:120px;font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"></textarea>
          <div class="actions">
            <button class="primary" id="inventory-add-save">Add to inventory</button>
            <span id="inventory-add-status" class="muted"></span>
          </div>
        </section>
        <details class="panel">
          <summary style="cursor:pointer;font-weight:650">Raw JSON editor (replace the whole inventory)</summary>
          <textarea id="inventory-json" spellcheck="false" style="min-height:300px;margin-top:10px;font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"></textarea>
          <div class="actions">
            <span>
              <button class="primary" id="inventory-save">Validate &amp; save</button>
              <button id="inventory-format">Format</button>
              <button id="inventory-reset">Reset to saved</button>
            </span>
          </div>
        </details>
        <section class="panel">
          <h2>Prompt template for generating entries</h2>
          <pre id="inventory-prompt">Generate a JSON array of monitored vendor products for a cyber threat watch tool.
For each product include: "vendor" (company name), "product" (official product name),
"aliases" (array: abbreviations, former names, alternate spellings, related module names
that news articles use), "criticality" (one of "critical", "high", "medium", "low"),
"inProduction" (boolean), "newsVolume" (one of "quiet", "noisy").

Products to cover: &lt;list your products here&gt;

Example entry:
{
  "vendor": "CyberArk",
  "product": "Privileged Access Security",
  "aliases": ["CyberArk PAS", "CyberArk PAM", "CyberArk Privileged Access Manager"],
  "criticality": "critical",
  "inProduction": true,
  "newsVolume": "quiet"
}

Return ONLY the JSON array, no commentary.</pre>
        </section>
        <section class="panel">
          <h2>After saving</h2>
          <p class="muted">This process picks up changes immediately. Long-running pipeline processes (scheduler/worker) need a restart, and run <code>npm run seed:vendors</code> to sync the database copy used by later stages. Already-filtered articles keep their old decisions — reset them to NEW and re-run <code>npm run filter:articles</code> to re-score.</p>
        </section>
      </div>
    </div>
    <div id="live-view" class="layout" style="display:none">
      <aside class="sidebar">
        <div id="live-summary" class="summary"></div>
        <div style="padding:10px 12px;border-bottom:1px solid var(--line)">
          <select id="live-origin">
            <option value="all" selected>Both origins</option>
            <option value="live">Live RSS</option>
            <option value="manual">My articles</option>
          </select>
          <select id="live-filter">
            <option value="ALL">All decisions</option>
            <option value="KEEP">KEEP</option>
            <option value="MAYBE_KEEP" selected>MAYBE_KEEP</option>
            <option value="DROP">DROP</option>
          </select>
          <select id="live-limit">
            <option value="50" selected>50 latest</option>
            <option value="100">100 latest</option>
            <option value="200">200 latest</option>
          </select>
        </div>
        <div id="live-list" class="item-list"><p class="empty">Loading live decisions...</p></div>
      </aside>
      <main id="live-detail" class="content"><p class="empty">Select an article.</p></main>
    </div>
    <div id="label-view" class="layout">
      <aside class="sidebar">
        <div id="label-summary" class="summary"></div>
        <div id="candidate-list" class="item-list"><p class="empty">Loading candidates...</p></div>
      </aside>
      <main id="label-detail" class="content"><p class="empty">Select a candidate.</p></main>
    </div>
    <div id="report-view" class="layout" style="display:none">
      <aside class="sidebar">
        <div id="report-summary" class="summary"></div>
        <div id="result-list" class="item-list"><p class="empty">Loading report...</p></div>
      </aside>
      <main id="report-detail" class="content"><p class="empty">Select a sample for the full breakdown.</p></main>
    </div>
    <div id="llm-view" class="llm-layout" style="display:none">
      <aside class="llm-list">
        <div id="llm-summary" class="summary"></div>
        <div id="llm-run-list" class="item-list"><p class="empty">Loading LLM evaluations...</p></div>
      </aside>
      <main id="llm-detail" class="content"><p class="empty">Select an LLM evaluation run.</p></main>
    </div>
  </section>
`;

/**
 * Self-contained JavaScript body. Defines `initEvalPane(state, hooks)` which:
 *   - mounts all event listeners to the existing DOM (eval-pane section)
 *   - reads/writes state.eval.*  (sub-state of the shared state object)
 *   - calls hooks.onLiveArticleSelected(id) when an article is picked in the
 *     Live tab, so the parent can propagate selection across panes
 *   - calls hooks.onEvalRefreshed() when the user hits the eval-pane Refresh
 *
 * The eval logic is unchanged from the staged iframe version aside from:
 *   - renaming IDs that would collide with the parent's DOM
 *     (id="refresh" → id="eval-refresh", id="tab-*" → id="eval-tab-*")
 *   - moving eval state onto state.eval.* (was state.* in the standalone file)
 *   - dropping the postMessage bridge and the window.parent detection branch
 */
const EVAL_PANE_SCRIPT = `
    function initEvalPane(state, hooks) {
      hooks = hooks || {};
      const API_PREFIX = state.apiPrefix || '/api/eval';
      const evalState = state.eval;
      const LABELS = [
        { value: 'CRITICAL_RELEVANT', text: 'Critical', cls: 'lbl-critical', hint: 'Must be KEPT (active exploitation, KEV, monitored product hit)' },
        { value: 'RELEVANT', text: 'Relevant', cls: 'lbl-relevant', hint: 'Should at least survive as MAYBE_KEEP' },
        { value: 'WEAK_RELEVANT', text: 'Weak', cls: 'lbl-weak', hint: 'Tangential; MAYBE_KEEP acceptable' },
        { value: 'IRRELEVANT', text: 'Irrelevant', cls: 'lbl-irrelevant', hint: 'Should be DROPPED' },
      ];
      const SEVERITY_RANK = { severe: 0, high: 1, medium: 2, low: 3 };

      document.getElementById('eval-tab-label').addEventListener('click', () => switchTab('label'));
      document.getElementById('eval-tab-live').addEventListener('click', () => switchTab('live'));
      document.getElementById('eval-tab-report').addEventListener('click', () => switchTab('report'));
      document.getElementById('eval-tab-llm').addEventListener('click', () => switchTab('llm'));
      document.getElementById('eval-tab-inventory').addEventListener('click', () => switchTab('inventory'));
      document.getElementById('inventory-save').addEventListener('click', saveInventory);
      document.getElementById('inventory-format').addEventListener('click', formatInventory);
      document.getElementById('inventory-add-save').addEventListener('click', addInventoryFromJson);
      document.getElementById('inventory-search').addEventListener('input', () => { evalState.inventoryEditing = null; renderInventoryTable(); });
      document.getElementById('inventory-crit').addEventListener('change', () => { evalState.inventoryEditing = null; renderInventoryTable(); });
      document.getElementById('inventory-reset').addEventListener('click', loadInventory);
      document.getElementById('eval-refresh').addEventListener('click', () => {
        loadAll();
        if (hooks.onEvalRefreshed) hooks.onEvalRefreshed();
      });
      document.getElementById('live-origin').addEventListener('change', loadLive);
      document.getElementById('live-filter').addEventListener('change', loadLive);
      document.getElementById('live-limit').addEventListener('change', loadLive);
      loadAll();

      function switchTab(tab) {
        evalState.tab = tab;
        for (const name of ['label', 'live', 'report', 'llm', 'inventory']) {
          document.getElementById('eval-tab-' + name).classList.toggle('active', tab === name);
          document.getElementById(name + '-view').style.display = tab === name ? '' : 'none';
        }
        if (tab === 'llm') loadLlmEvaluations();
      }

      async function loadAll() {
        await Promise.all([loadCandidates(), loadReport(), loadLive(), loadInventory(), loadLlmEvaluations()]);
      }

      // ---------- Inventory tab ----------

      async function loadInventory() {
        const data = await (await fetch(API_PREFIX + '/inventory')).json();
        evalState.inventory = data.vendors;
        evalState.inventoryEditing = null;
        document.getElementById('inventory-json').value = JSON.stringify(data.vendors, null, 2);
        renderInventoryTable();
        document.getElementById('inventory-status').textContent = '';
      }

      function critBadge(criticality) {
        return badge(criticality, criticality === 'critical' ? 'bad' : criticality === 'high' ? 'warn' : 'good');
      }

      const CRITICALITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

      function visibleInventoryRows() {
        const query = (document.getElementById('inventory-search').value || '').trim().toLowerCase();
        const crit = document.getElementById('inventory-crit').value;
        return (evalState.inventory || [])
          .map((item, originalIndex) => ({ item, originalIndex }))
          .filter(({ item }) => crit === 'ALL' || item.criticality === crit)
          .filter(({ item }) =>
            !query ||
            item.vendor.toLowerCase().includes(query) ||
            item.product.toLowerCase().includes(query))
          .sort((a, b) =>
            (CRITICALITY_RANK[a.item.criticality] ?? 9) - (CRITICALITY_RANK[b.item.criticality] ?? 9) ||
            a.item.vendor.localeCompare(b.item.vendor) ||
            a.item.product.localeCompare(b.item.product));
      }

      function renderInventoryTable() {
        const container = document.getElementById('inventory-table');
        const total = (evalState.inventory || []).length;
        if (total === 0) {
          container.innerHTML = '<p class="empty">Inventory is empty. Add products below.</p>';
          document.getElementById('inventory-count').textContent = '';
          return;
        }
        const rows = visibleInventoryRows();
        document.getElementById('inventory-count').textContent = rows.length === total
          ? total + ' products'
          : rows.length + ' of ' + total + ' products';
        if (rows.length === 0) {
          container.innerHTML = '<p class="empty">No products match the search/filter.</p>';
          return;
        }
        container.innerHTML = '<table><tr><th>Vendor</th><th>Product</th><th>Aliases</th><th>Criticality</th><th>Volume</th><th>In prod</th><th style="width:120px">Actions</th></tr>' +
          rows.map(({ item, originalIndex }) =>
            evalState.inventoryEditing === originalIndex ? editorRow(item, originalIndex) : displayRow(item, originalIndex)
          ).join('') +
        '</table>';
        for (const button of container.querySelectorAll('[data-action]')) {
          const index = Number(button.dataset.index);
          const action = button.dataset.action;
          button.addEventListener('click', () => {
            if (action === 'edit') { evalState.inventoryEditing = index; renderInventoryTable(); }
            if (action === 'cancel') { evalState.inventoryEditing = null; renderInventoryTable(); }
            if (action === 'save') saveInventoryRow(index);
            if (action === 'delete') deleteInventoryRow(index);
          });
        }
      }

      function displayRow(v, i) {
        return '<tr>' +
          '<td>' + escapeHtml(v.vendor) + '</td>' +
          '<td>' + escapeHtml(v.product) + '</td>' +
          '<td><div class="badges">' + v.aliases.map((a) => badge(a)).join('') + '</div></td>' +
          '<td>' + critBadge(v.criticality) + '</td>' +
          '<td>' + badge(v.newsVolume || 'quiet', (v.newsVolume || 'quiet') === 'noisy' ? 'warn' : 'good') + '</td>' +
          '<td>' + (v.inProduction ? 'yes' : 'no') + '</td>' +
          '<td><button data-action="edit" data-index="' + i + '">Edit</button> <button data-action="delete" data-index="' + i + '">Delete</button></td>' +
        '</tr>';
      }

      function editorRow(v, i) {
        const criticalities = ['critical', 'high', 'medium', 'low'];
        const volumes = ['quiet', 'noisy'];
        return '<tr style="background:#fbfcfd">' +
          '<td><input id="edit-vendor" value="' + escapeAttr(v.vendor) + '" style="width:100%"></td>' +
          '<td><input id="edit-product" value="' + escapeAttr(v.product) + '" style="width:100%"></td>' +
          '<td><textarea id="edit-aliases" style="width:100%;min-height:60px" placeholder="comma-separated">' + escapeHtml(v.aliases.join(', ')) + '</textarea></td>' +
          '<td><select id="edit-criticality">' + criticalities.map((c) =>
            '<option value="' + c + '"' + (c === v.criticality ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></td>' +
          '<td><select id="edit-news-volume">' + volumes.map((volume) =>
            '<option value="' + volume + '"' + (volume === (v.newsVolume || 'quiet') ? ' selected' : '') + '>' + volume + '</option>').join('') + '</select></td>' +
          '<td><input id="edit-inproduction" type="checkbox"' + (v.inProduction ? ' checked' : '') + '></td>' +
          '<td><button class="primary" data-action="save" data-index="' + i + '">Save</button> <button data-action="cancel" data-index="' + i + '">Cancel</button></td>' +
        '</tr>';
      }

      async function saveInventoryRow(index) {
        const updated = evalState.inventory.slice();
        const previous = updated[index];
        updated[index] = {
          vendor: document.getElementById('edit-vendor').value.trim(),
          product: document.getElementById('edit-product').value.trim(),
          aliases: document.getElementById('edit-aliases').value.split(',').map((a) => a.trim()).filter(Boolean),
          criticality: document.getElementById('edit-criticality').value,
          inProduction: document.getElementById('edit-inproduction').checked,
          newsVolume: document.getElementById('edit-news-volume').value,
        };
        // Keep the id only if vendor+product did not change; otherwise let the server re-derive it.
        if (previous.vendor === updated[index].vendor && previous.product === updated[index].product) {
          updated[index].id = previous.id;
        }
        await postInventory(updated, 'Row saved.');
      }

      async function deleteInventoryRow(index) {
        const item = evalState.inventory[index];
        if (!confirm('Remove ' + item.vendor + ' / ' + item.product + ' from the inventory?')) return;
        const updated = evalState.inventory.slice();
        updated.splice(index, 1);
        await postInventory(updated, 'Removed ' + item.vendor + ' / ' + item.product + '.');
      }

      async function addInventoryFromJson() {
        const status = document.getElementById('inventory-add-status');
        const box = document.getElementById('inventory-add');
        let parsed;
        try {
          parsed = JSON.parse(box.value);
        } catch (error) {
          status.textContent = 'Invalid JSON: ' + error.message;
          return;
        }
        const additions = Array.isArray(parsed) ? parsed : [parsed];
        const ok = await postInventory(evalState.inventory.concat(additions), 'Added ' + additions.length + ' product(s).', status);
        if (ok) box.value = '';
      }

      async function postInventory(vendors, successMessage, statusElement) {
        const status = statusElement || document.getElementById('inventory-status');
        status.textContent = 'Saving...';
        const response = await fetch(API_PREFIX + '/inventory', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(vendors),
        });
        const data = await response.json();
        if (!response.ok) {
          status.textContent = data.error?.message || 'Failed to save.';
          return false;
        }
        evalState.inventory = data.vendors;
        evalState.inventoryEditing = null;
        renderInventoryTable();
        document.getElementById('inventory-json').value = JSON.stringify(data.vendors, null, 2);
        status.textContent = successMessage + ' Inventory now has ' + data.vendors.length + ' products; report and live tabs use the new aliases.';
        await loadReport();
        return true;
      }

      function formatInventory() {
        const status = document.getElementById('inventory-status');
        try {
          const box = document.getElementById('inventory-json');
          box.value = JSON.stringify(JSON.parse(box.value), null, 2);
          status.textContent = 'Formatted.';
        } catch (error) {
          status.textContent = 'Invalid JSON: ' + error.message;
        }
      }

      async function saveInventory() {
        const status = document.getElementById('inventory-status');
        let parsed;
        try {
          parsed = JSON.parse(document.getElementById('inventory-json').value);
        } catch (error) {
          status.textContent = 'Invalid JSON: ' + error.message;
          return;
        }
        await postInventory(parsed, 'Inventory replaced.');
      }

      // ---------- Live decisions tab ----------

      async function loadLive() {
        const decision = document.getElementById('live-filter').value;
        const origin = document.getElementById('live-origin').value;
        const limit = document.getElementById('live-limit').value;
        const selected = evalState.selectedArticleId;
        const response = await fetch(API_PREFIX + '/decisions?decision=' + encodeURIComponent(decision) + '&origin=' + encodeURIComponent(origin) + '&limit=' + encodeURIComponent(limit) + (selected ? '&articleId=' + encodeURIComponent(selected) : ''));
        evalState.live = await response.json();
        if (evalState.live.enabled && !evalState.live.articles.some((a) => a.articleId === evalState.selectedArticleId)) {
          evalState.selectedArticleId = evalState.live.articles[0]?.articleId ?? null;
        }
        evalState.livePickedLabel = null;
        renderLiveView();
      }

      function renderLiveView() {
        const live = evalState.live;
        const list = document.getElementById('live-list');
        if (!live) return;
        if (!live.enabled) {
          document.getElementById('live-summary').innerHTML = '';
          list.innerHTML = '<p class="empty">' + escapeHtml(live.message) + '</p>';
          document.getElementById('live-detail').innerHTML = '<p class="empty">Database not connected.</p>';
          return;
        }
        document.getElementById('live-summary').innerHTML =
          metric('KEEP', live.summary.KEEP) + metric('MAYBE_KEEP', live.summary.MAYBE_KEEP) +
          metric('DROP', live.summary.DROP) + metric('Shown', live.articles.length);
        if (live.articles.length === 0) {
          list.innerHTML = '<p class="empty">No articles with this decision. Run npm run filter:articles first.</p>';
          document.getElementById('live-detail').innerHTML = '<p class="empty">Nothing to show.</p>';
          return;
        }
        list.innerHTML = live.articles.map((a) => {
          const active = a.articleId === evalState.selectedArticleId ? ' active' : '';
          return '<button class="item-button' + active + '" data-id="' + escapeAttr(a.articleId) + '">' +
            '<div class="item-title">' + escapeHtml(a.title) + '</div>' +
            '<div class="muted">' + escapeHtml(a.sourceName) + ' · ' + formatDate(a.publishedAt) + '</div>' +
            '<div class="badges">' + decisionBadge(a.decision) + badge('score ' + (a.score ?? 'n/a')) +
              (a.isManual ? badge('my article', 'warn') : '') +
              (a.alreadyLabeled ? badge('in dataset', 'good') : '') + '</div>' +
          '</button>';
        }).join('');
        for (const button of list.querySelectorAll('.item-button')) {
          button.addEventListener('click', () => {
            evalState.selectedArticleId = button.dataset.id;
            evalState.livePickedLabel = null;
            renderLiveView();
            if (hooks.onLiveArticleSelected) hooks.onLiveArticleSelected(button.dataset.id);
          });
        }
        renderLiveDetail(live.articles.find((a) => a.articleId === evalState.selectedArticleId));
      }

      function renderLiveDetail(article) {
        const detail = document.getElementById('live-detail');
        if (!article) { detail.innerHTML = '<p class="empty">Nothing selected.</p>'; return; }
        const labelPanel = article.alreadyLabeled
          ? panel('Your judgement', '<p class="muted">Already in the eval dataset. See the Report tab for how the filter scores it.</p>')
          : panel('Add to eval dataset',
              '<div class="label-buttons">' + LABELS.map((l) =>
                '<button type="button" class="' + l.cls + (evalState.livePickedLabel === l.value ? ' selected' : '') + '" data-label="' + l.value + '" title="' + escapeAttr(l.hint) + '">' + l.text + '</button>'
              ).join('') + '</div>' +
              '<div class="muted" id="live-label-hint">Label this real article to grow the eval dataset.</div>' +
              '<h3>Why? (saved as humanReason)</h3>' +
              '<textarea id="live-reason" placeholder="e.g. Routine advisory for monitored product"></textarea>' +
              '<div class="actions"><button class="primary" id="live-save">Save to dataset</button><span id="live-status" class="muted"></span></div>');
        detail.innerHTML =
          panel('Article', kvText('Source', article.sourceName + ' (' + article.sourceTier + ')') +
            kvText('Published', formatDate(article.publishedAt)) +
            kvText('Pipeline status', article.processingStatus) +
            kvText('Categories', article.rssCategories.join(', ') || 'none') +
            kvHtml('URL', '<a href="' + escapeAttr(article.url) + '" target="_blank" rel="noreferrer">open article</a>') +
            '<h3>Title</h3><pre>' + escapeHtml(article.title) + '</pre>' +
            '<h3>RSS summary</h3><pre>' + escapeHtml(article.rssSummary || '(empty)') + '</pre>') +
          panel('Filter output', kvHtml('Decision', decisionBadge(article.decision) + ' score ' + (article.score ?? 'n/a')) +
            '<h3>Reasons</h3><pre>' + escapeHtml((article.reasons || []).join('\\n') || '(none)') + '</pre>' +
            '<h3>Blocking reasons</h3><pre>' + escapeHtml((article.blockingReasons || []).join('\\n') || '(none)') + '</pre>' +
            '<h3>Matched signals</h3><pre>' + escapeHtml(JSON.stringify(article.matchedSignals, null, 2)) + '</pre>') +
          labelPanel;
        for (const button of detail.querySelectorAll('.label-buttons button')) {
          button.addEventListener('click', () => {
            evalState.livePickedLabel = button.dataset.label;
            for (const other of detail.querySelectorAll('.label-buttons button')) other.classList.toggle('selected', other === button);
            document.getElementById('live-label-hint').textContent = LABELS.find((l) => l.value === evalState.livePickedLabel)?.hint ?? '';
          });
        }
        const save = document.getElementById('live-save');
        if (save) save.addEventListener('click', () => saveLiveLabel(article));
      }

      async function saveLiveLabel(article) {
        const status = document.getElementById('live-status');
        const reason = document.getElementById('live-reason').value.trim();
        if (!evalState.livePickedLabel) { status.textContent = 'Pick a label first.'; return; }
        if (reason.length < 3) { status.textContent = 'Add a short reason (min 3 chars).'; return; }
        status.textContent = 'Saving...';
        const response = await fetch(API_PREFIX + '/labels/from-article', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ articleId: article.articleId, humanLabel: evalState.livePickedLabel, humanReason: reason }),
        });
        if (!response.ok) {
          const error = await response.json();
          status.textContent = error.error?.message || 'Failed to save.';
          return;
        }
        await Promise.all([loadLive(), loadReport(), loadCandidates()]);
      }

      async function loadCandidates() {
        const response = await fetch(API_PREFIX + '/candidates');
        const data = await response.json();
        evalState.candidates = data.candidates;
        evalState.pendingCount = data.pendingCount;
        evalState.labeledCount = data.labeledCount;
        if (!evalState.candidates.some((c) => c.id === evalState.selectedCandidateId)) {
          evalState.selectedCandidateId = evalState.candidates[0]?.id ?? null;
        }
        evalState.pickedLabel = null;
        renderLabelView();
      }

      async function loadReport() {
        const response = await fetch(API_PREFIX + '/report');
        evalState.report = await response.json();
        renderReportView();
      }

      // ---------- Labeling tab ----------

      function renderLabelView() {
        document.getElementById('label-summary').innerHTML =
          metric('To label', evalState.pendingCount) + metric('In dataset', evalState.labeledCount);
        const list = document.getElementById('candidate-list');
        if (evalState.candidates.length === 0) {
          list.innerHTML = '<p class="empty">No pending candidates. Run <code>npm run eval:candidates</code> to harvest more from the pipeline.</p>';
          document.getElementById('label-detail').innerHTML = '<p class="empty">Nothing to label.</p>';
          return;
        }
        list.innerHTML = evalState.candidates.map((c) => {
          const active = c.id === evalState.selectedCandidateId ? ' active' : '';
          return '<button class="item-button' + active + '" data-id="' + escapeAttr(c.id) + '">' +
            '<div class="item-title">' + escapeHtml(c.title) + '</div>' +
            '<div class="muted">' + escapeHtml(c.sourceName) + ' · ' + formatDate(c.publishedAt) + '</div>' +
            '<div class="badges">' + decisionBadge(c.harvest.decision) + badge('score ' + (c.harvest.score ?? 'n/a')) + badge(c.sourceTier) + '</div>' +
          '</button>';
        }).join('');
        for (const button of list.querySelectorAll('.item-button')) {
          button.addEventListener('click', () => { evalState.selectedCandidateId = button.dataset.id; evalState.pickedLabel = null; renderLabelView(); });
        }
        renderLabelDetail(evalState.candidates.find((c) => c.id === evalState.selectedCandidateId));
      }

      function renderLabelDetail(candidate) {
        const detail = document.getElementById('label-detail');
        if (!candidate) { detail.innerHTML = '<p class="empty">Nothing selected.</p>'; return; }
        detail.innerHTML =
          panel('Candidate', kvText('Source', candidate.sourceName + ' (' + candidate.sourceTier + ')') +
            kvText('Published', formatDate(candidate.publishedAt)) +
            kvText('Filter said', candidate.harvest.decision + ' (score ' + (candidate.harvest.score ?? 'n/a') + ')') +
            kvText('Categories', candidate.rssCategories.join(', ') || 'none') +
            kvHtml('URL', '<a href="' + escapeAttr(candidate.url) + '" target="_blank" rel="noreferrer">open article</a>') +
            '<h3>Title</h3><pre>' + escapeHtml(candidate.title) + '</pre>' +
            '<h3>RSS summary</h3><pre>' + escapeHtml(candidate.rssSummary || '(empty)') + '</pre>') +
          panel('Your judgement',
            '<div class="label-buttons">' + LABELS.map((l) =>
              '<button type="button" class="' + l.cls + (evalState.pickedLabel === l.value ? ' selected' : '') + '" data-label="' + l.value + '" title="' + escapeAttr(l.hint) + '">' + l.text + '</button>'
            ).join('') + '</div>' +
            '<div class="muted" id="label-hint">' + escapeHtml(LABELS.find((l) => l.value === evalState.pickedLabel)?.hint ?? 'Pick a label; hover for what each implies.') + '</div>' +
            '<h3>Why? (saved as humanReason)</h3>' +
            '<textarea id="reason" placeholder="e.g. Actively exploited zero-day in monitored CyberArk PAM"></textarea>' +
            '<div class="actions"><button class="primary" id="save-label">Save &amp; next</button><span id="label-status" class="muted"></span></div>');
        for (const button of detail.querySelectorAll('.label-buttons button')) {
          button.addEventListener('click', () => {
            evalState.pickedLabel = button.dataset.label;
            for (const other of detail.querySelectorAll('.label-buttons button')) other.classList.toggle('selected', other === button);
            document.getElementById('label-hint').textContent = LABELS.find((l) => l.value === evalState.pickedLabel)?.hint ?? '';
          });
        }
        document.getElementById('save-label').addEventListener('click', () => saveLabel(candidate));
      }

      async function saveLabel(candidate) {
        const status = document.getElementById('label-status');
        const reason = document.getElementById('reason').value.trim();
        if (!evalState.pickedLabel) { status.textContent = 'Pick a label first.'; return; }
        if (reason.length < 3) { status.textContent = 'Add a short reason (min 3 chars).'; return; }
        status.textContent = 'Saving...';
        const response = await fetch(API_PREFIX + '/labels', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ candidateId: candidate.id, humanLabel: evalState.pickedLabel, humanReason: reason }),
        });
        if (!response.ok) {
          const error = await response.json();
          status.textContent = error.error?.message || 'Failed to save.';
          return;
        }
        await loadAll();
      }

      // ---------- Report tab ----------

      function renderReportView() {
        const report = evalState.report;
        if (!report) return;
        const m = report.metrics;
        document.getElementById('report-summary').innerHTML =
          metric('Samples', m.datasetSize) +
          metric('Gate', report.gate.passed ? 'PASS' : 'FAIL') +
          metric('Critical recall', pct(m.criticalRecall)) +
          metric('Relevant recall', pct(m.relevantRecall)) +
          metric('False negatives', report.falseNegatives.length) +
          metric('Pass-through', pct(m.passThroughRate));

        const failures = report.results.filter((r) => r.failed)
          .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
        const shown = evalState.resultFilter === 'all' ? report.results : failures;
        const list = document.getElementById('result-list');
        list.innerHTML =
          '<div style="padding:10px 12px;border-bottom:1px solid var(--line)"><select id="result-filter">' +
            '<option value="failures"' + (evalState.resultFilter === 'failures' ? ' selected' : '') + '>Failures (' + failures.length + ')</option>' +
            '<option value="all"' + (evalState.resultFilter === 'all' ? ' selected' : '') + '>All samples (' + report.results.length + ')</option>' +
          '</select></div>' +
          (shown.length === 0 ? '<p class="empty">No failures. Nice.</p>' : shown.map((r) => {
            const active = r.id === evalState.selectedResultId ? ' active' : '';
            return '<button class="item-button' + active + '" data-id="' + escapeAttr(r.id) + '">' +
              '<div class="item-title">' + escapeHtml(r.title) + '</div>' +
              '<div class="badges">' + labelBadge(r.humanLabel) + decisionBadge(r.decision) +
                (r.severity ? badge(r.severity, r.severity === 'severe' || r.severity === 'high' ? 'bad' : 'warn') : badge('ok', 'good')) +
              '</div></button>';
          }).join(''));
        document.getElementById('result-filter').addEventListener('change', (event) => {
          evalState.resultFilter = event.target.value; renderReportView();
        });
        for (const button of list.querySelectorAll('.item-button')) {
          button.addEventListener('click', () => { evalState.selectedResultId = button.dataset.id; renderReportView(); });
        }
        renderReportDetail(report, report.results.find((r) => r.id === evalState.selectedResultId) ?? null);
      }

      function renderReportDetail(report, result) {
        const detail = document.getElementById('report-detail');
        const gate = '<div class="gate-banner ' + (report.gate.passed ? 'gate-pass' : 'gate-fail') + '">' +
          '<strong>Gate ' + (report.gate.passed ? 'passed' : 'failed') + '</strong>' +
          listHtml(report.gate.failures) + listHtml(report.gate.warnings) + '</div>';
        const metricsPanel = panel('Metrics', '<div class="metrics-grid">' +
          metric('Critical recall', pct(report.metrics.criticalRecall)) +
          metric('Relevant recall', pct(report.metrics.relevantRecall)) +
          metric('Critical miss', pct(report.metrics.criticalMissRate)) +
          metric('False negative', pct(report.metrics.falseNegativeRate)) +
          metric('KEEP rate', pct(report.metrics.keepRate)) +
          metric('MAYBE_KEEP rate', pct(report.metrics.maybeKeepRate)) +
          metric('Irrelevant pass', pct(report.metrics.irrelevantPassRate)) +
          metric('Reason coverage', pct(report.metrics.reasonCodeCoverage)) +
          '</div>');
        const matrix = panel('Confusion matrix', confusionTable(report.confusionMatrix));
        const actions = panel('Recommended actions', '<ol style="margin:0;padding-left:18px">' +
          report.recommendedActions.map((a) => '<li>' + escapeHtml(a) + '</li>').join('') + '</ol>');

        let samplePanel = '';
        if (result) {
          samplePanel = panel('Sample: ' + escapeHtml(result.id),
            kvText('Title', result.title) +
            kvText('Source', result.sourceName + ' (' + result.sourceTier + ')') +
            kvHtml('Human label', labelBadge(result.humanLabel)) +
            kvText('Human reason', result.humanReason) +
            kvHtml('Filter decision', decisionBadge(result.decision) + ' score ' + result.score) +
            (result.failureType ? kvText('Failure', result.failureType + ' (' + result.severity + ')') : kvText('Failure', 'none')) +
            kvText('Bucket', result.failureBucket) +
            kvText('Suggested fix', result.suggestedFix) +
            '<h3>Filter reasons</h3><pre>' + escapeHtml(result.reasons.join('\\n') || '(none)') + '</pre>' +
            '<h3>Blocking reasons</h3><pre>' + escapeHtml(result.blockingReasons.join('\\n') || '(none)') + '</pre>' +
            '<h3>Matched signals</h3><pre>' + escapeHtml(JSON.stringify(result.matchedSignals, null, 2)) + '</pre>' +
            '<h3>RSS summary</h3><pre>' + escapeHtml(result.rssSummary || '(empty)') + '</pre>');
        }
        detail.innerHTML = gate + samplePanel + metricsPanel + matrix + actions;
      }

      function confusionTable(matrix) {
        const decisions = ['KEEP', 'MAYBE_KEEP', 'DROP'];
        return '<table><tr><th>Human label</th>' + decisions.map((d) => '<th class="num">' + d + '</th>').join('') + '</tr>' +
          Object.keys(matrix).map((label) => '<tr><td>' + escapeHtml(label) + '</td>' +
            decisions.map((d) => '<td class="num">' + matrix[label][d] + '</td>').join('') + '</tr>').join('') + '</table>';
      }

      // ---------- LLM evaluation tab ----------

      async function loadLlmEvaluations(runId = null) {
        const params = new URLSearchParams({ limit: '20' });
        if (runId) params.set('runId', runId);
        try {
          const response = await fetch('/api/llm-evaluations?' + params.toString());
          if (!response.ok) {
            evalState.llmDashboard = { available: false, runs: [], selectedRun: null, message: 'LLM evaluations are unavailable (HTTP ' + response.status + ').' };
            renderLlmEvaluationView();
            return;
          }
          evalState.llmDashboard = await response.json();
          evalState.selectedRunId = evalState.llmDashboard?.selectedRun?.id ?? evalState.llmDashboard?.runs?.[0]?.id ?? null;
          renderLlmEvaluationView();
        } catch (error) {
          evalState.llmDashboard = { available: false, runs: [], selectedRun: null, message: 'LLM evaluations could not be loaded.' };
          renderLlmEvaluationView();
        }
      }

      function renderLlmEvaluationView() {
        const dashboard = evalState.llmDashboard;
        const run = dashboard?.selectedRun;
        const metrics = run?.metrics;
        document.getElementById('llm-summary').innerHTML = [
          metric('Runs', dashboard?.runs?.length ?? 0),
          metric('Evaluated', metrics?.totalEvaluated ?? 0),
          metric('False negatives', metrics?.falseNegativeRisks ?? 0),
          metric('False positives', metrics?.falsePositiveRisks ?? 0),
        ].join('');
        renderLlmRunList(dashboard?.runs ?? []);
        renderLlmRunDetail(run, dashboard);
      }

      function renderLlmRunList(runs) {
        const list = document.getElementById('llm-run-list');
        if (!evalState.llmDashboard?.available) {
          list.innerHTML = '<p class="empty">' + escapeHtml(evalState.llmDashboard?.message || 'LLM evaluation is unavailable.') + '</p>';
          return;
        }
        if (runs.length === 0) {
          list.innerHTML = '<p class="empty">' + escapeHtml(evalState.llmDashboard?.message || 'No LLM evaluation runs found.') + '</p>';
          return;
        }
        list.innerHTML = runs.map((run) => {
          const active = run.id === evalState.selectedRunId ? ' active' : '';
          return '<button class="llm-run-button' + active + '" data-id="' + escapeAttr(run.id) + '">' +
            '<div class="item-title">' + escapeHtml(run.modelName) + '</div>' +
            '<div class="muted">' + escapeHtml(formatDate(run.startedAt)) + '</div>' +
            '<div class="badges">' +
              badge(String(run.totalEvaluationsSaved) + ' judged', run.totalEvaluationsFailed > 0 ? 'warn' : 'good') +
              (run.totalEvaluationsFailed > 0 ? badge(String(run.totalEvaluationsFailed) + ' failed', 'bad') : '') +
            '</div>' +
          '</button>';
        }).join('');
        for (const button of list.querySelectorAll('.llm-run-button')) {
          button.addEventListener('click', async () => {
            evalState.selectedRunId = button.dataset.id;
            await loadLlmEvaluations(evalState.selectedRunId);
          });
        }
      }

      function renderLlmRunDetail(run, dashboard) {
        const detail = document.getElementById('llm-detail');
        if (!dashboard?.available) {
          detail.innerHTML = '<p class="empty">' + escapeHtml(dashboard?.message || 'LLM evaluation is unavailable.') + '</p>';
          return;
        }
        if (!run) {
          detail.innerHTML = '<p class="empty">' + escapeHtml(dashboard?.message || 'Run the LLM judge, then refresh this tab.') + '</p>';
          return;
        }
        detail.innerHTML =
          panel('Run Summary', llmRunSummaryHtml(run)) +
          panel('Priority Findings', llmPriorityHtml(run)) +
          panel('Scoring Issues', countTable(run.issueCounts, 'Issue')) +
          panel('Relevance Types', countTable(run.relevanceCounts, 'Type'));
      }

      function llmRunSummaryHtml(run) {
        const metrics = run.metrics;
        return kvText('Run ID', run.id) +
          kvText('Model', run.modelName) +
          kvText('Prompt', run.promptVersion) +
          kvText('Started', formatDate(run.startedAt)) +
          kvText('Finished', formatDate(run.finishedAt)) +
          kvText('Sampled', String(run.totalArticlesSampled)) +
          kvText('Saved / failed', String(run.totalEvaluationsSaved) + ' / ' + String(run.totalEvaluationsFailed)) +
          '<h3>Labels</h3>' +
          '<div class="metrics-grid">' +
            metric('Critical', metrics.criticalRelevant) +
            metric('Relevant', metrics.relevant) +
            metric('Borderline', metrics.borderline) +
            metric('Irrelevant', metrics.irrelevant) +
          '</div>' +
          '<h3>Quality signals</h3>' +
          '<div class="metrics-grid">' +
            metric('False negatives', metrics.falseNegativeRisks) +
            metric('False positives', metrics.falsePositiveRisks) +
            metric('Over-scored irrelevant', metrics.overScoredIrrelevant) +
            metric('Under-scored critical', metrics.underScoredCritical) +
          '</div>';
      }

      function llmPriorityHtml(run) {
        const rows = run.evaluations || [];
        if (rows.length === 0) return '<p class="muted">No saved evaluations in this run.</p>';
        return '<table><thead><tr><th>Article</th><th>Cheap filter</th><th>LLM judge</th><th>Why it matters</th></tr></thead><tbody>' +
          rows.slice(0, 40).map((item) => '<tr>' +
            '<td>' +
              (item.articleUrl ? '<a href="' + escapeAttr(item.articleUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(item.articleTitle || 'Article ' + item.articleId) + '</a>' : escapeHtml(item.articleTitle || 'Article ' + item.articleId)) +
              '<div class="muted">' + escapeHtml(item.sourceName || 'unknown source') + ' · ' + formatDate(item.publishedAt) + '</div>' +
            '</td>' +
            '<td>' + decisionBadge(item.cheapFilterDecision) + '<div class="muted">score ' + escapeHtml(String(item.cheapFilterScore)) + '</div></td>' +
            '<td>' + labelBadge(item.llmLabel) + '<div class="muted">' + escapeHtml(item.scoreAssessment) + (item.recommendedScoreBand ? ' · ' + escapeHtml(item.recommendedScoreBand) : '') + '</div></td>' +
            '<td>' +
              '<div>' + escapeHtml(item.scoringIssue) + '</div>' +
              '<div class="muted">' + escapeHtml(item.explanation) + '</div>' +
              llmSuggestionsHtml(item) +
            '</td>' +
          '</tr>').join('') +
        '</tbody></table>';
      }

      function llmSuggestionsHtml(item) {
        const suggestions = [
          ...(item.suggestedRuleChanges || []).map((value) => 'Rule: ' + value),
          ...(item.suggestedKeywordsToAdd || []).map((value) => 'Keyword: ' + value),
          ...(item.suggestedVendorProductAliasesToAdd || []).map((value) => 'Alias: ' + value),
        ];
        if (suggestions.length === 0) return '';
        return '<div class="badges" style="margin-top:8px">' + suggestions.slice(0, 4).map((value) => badge(value, 'warn')).join('') + '</div>';
      }

      function countTable(rows, label) {
        if (!rows || rows.length === 0) return '<p class="muted">No data.</p>';
        return '<table><thead><tr><th>' + escapeHtml(label) + '</th><th class="num">Count</th></tr></thead><tbody>' +
          rows.map((row) => '<tr><td>' + escapeHtml(row.key) + '</td><td class="num">' + escapeHtml(String(row.count)) + '</td></tr>').join('') +
        '</tbody></table>';
      }

      // ---------- helpers ----------

      function decisionBadge(decision) {
        const tone = decision === 'KEEP' ? 'good' : decision === 'MAYBE_KEEP' ? 'warn' : 'bad';
        return badge(decision, tone);
      }
      function labelBadge(label) {
        const tone = label === 'CRITICAL_RELEVANT' ? 'bad' : label === 'RELEVANT' ? 'warn' : label === 'IRRELEVANT' ? 'good' : '';
        return badge(label, tone);
      }
      function listHtml(items) {
        return items.length ? '<ul style="margin:6px 0 0;padding-left:18px">' + items.map((i) => '<li>' + escapeHtml(i) + '</li>').join('') + '</ul>' : '';
      }
      function metric(label, value) { return '<div class="metric"><strong>' + escapeHtml(String(value)) + '</strong><span class="muted">' + escapeHtml(label) + '</span></div>'; }
      function panel(title, body) { return '<section class="panel"><h2>' + title + '</h2>' + body + '</section>'; }
      function kvText(label, value) { return '<div class="kv"><span>' + escapeHtml(label) + '</span><span>' + escapeHtml(value) + '</span></div>'; }
      function kvHtml(label, valueHtml) { return '<div class="kv"><span>' + escapeHtml(label) + '</span><span>' + valueHtml + '</span></div>'; }
      function badge(text, tone = '') { return '<span class="badge ' + escapeAttr(tone) + '">' + escapeHtml(text) + '</span>'; }
      function pct(value) { return (value * 100).toFixed(1) + '%'; }
      function formatDate(value) { return value ? String(value).replace('T', ' ').replace(/\\.\\d{3}Z$/, ' UTC') : 'unknown'; }
      function escapeHtml(value) {
        return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      }
      function escapeAttr(value) { return escapeHtml(value).replaceAll('\\x60', '&#96;'); }
    }
`;

export function evalPaneStyles(): string {
  return EVAL_CSS;
}

export function renderEvalPane(): string {
  return EVAL_PANE_HTML;
}

export function evalPaneBodyScript(): string {
  return EVAL_PANE_SCRIPT;
}

/**
 * Default state shape expected on the `state.eval` sub-object.
 * Callers (parent shell, or this standalone wrapper) must initialize one with
 * these fields before invoking `initEvalPane`.
 */
export function defaultEvalPaneState(): {
  tab: string;
  candidates: unknown[];
  pendingCount: number;
  labeledCount: number;
  selectedCandidateId: string | null;
  pickedLabel: string | null;
  report: unknown;
  selectedResultId: string | null;
  resultFilter: 'failures' | 'all';
  live: unknown;
  selectedArticleId: string | null;
  livePickedLabel: string | null;
  inventory: unknown[];
  inventoryEditing: number | null;
  llmDashboard: unknown;
  selectedRunId: string | null;
} {
  return {
    tab: 'label',
    candidates: [],
    pendingCount: 0,
    labeledCount: 0,
    selectedCandidateId: null,
    pickedLabel: null,
    report: null,
    selectedResultId: null,
    resultFilter: 'failures',
    live: null,
    selectedArticleId: null,
    livePickedLabel: null,
    inventory: [],
    inventoryEditing: null,
    llmDashboard: null,
    selectedRunId: null,
  };
}

export function renderEvalReviewApp(options: { apiPrefix?: string } = {}): string {
  const apiPrefix = options.apiPrefix ?? '/api';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cheap Filter Eval Review</title>
  <style>${EVAL_CSS}  </style>
</head>
<body>
  <header>
    <h1>Cheap Filter Eval Review</h1>
    <div class="tabs">
      <button id="eval-tab-label" class="active">Label candidates</button>
      <button id="eval-tab-live">Live decisions</button>
      <button id="eval-tab-report">Report</button>
      <button id="eval-tab-llm">LLM evaluation</button>
      <button id="eval-tab-inventory">Inventory</button>
      <button id="eval-refresh">Refresh</button>
    </div>
  </header>
  ${EVAL_PANE_HTML.replace(/<section id="eval-pane"[^>]*>/, '<section id="eval-pane">')}
  <script>
    const state = { view: 'eval', apiPrefix: ${JSON.stringify(apiPrefix)} };
    state.eval = {
      tab: 'label',
      candidates: [], pendingCount: 0, labeledCount: 0, selectedCandidateId: null,
      pickedLabel: null,
      report: null, selectedResultId: null, resultFilter: 'failures',
      live: null, selectedArticleId: null, livePickedLabel: null,
      inventory: [], inventoryEditing: null,
      llmDashboard: null, selectedRunId: null,
    };
    ${EVAL_PANE_SCRIPT}
    initEvalPane(state);
  </script>
</body>
</html>`;
}
