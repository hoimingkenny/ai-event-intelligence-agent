/**
 * Grouping eval pane — gold incidents, ad-hoc pairs, visual threshold tuner.
 * Composed like cheap-filter eval: styles + body + init script for the review shell.
 */

import {
  EMBEDDING_ATTACH_DISTANCE,
  EMBEDDING_UNCERTAIN_DISTANCE,
} from '../../events/grouping-decision.js';

const GROUPING_CSS = `
    #grouping-pane .layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: calc(100vh - 110px); }
    #grouping-pane .sidebar { border-right: 1px solid var(--line); background: var(--surface); }
    #grouping-pane .item-button { width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 11px 12px; background: var(--surface); }
    #grouping-pane .item-button.active { background: #e9f6f4; box-shadow: inset 3px 0 0 var(--accent); }
    #grouping-pane .search-results { max-height: 220px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
    #grouping-pane .pair-row { border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fbfcfd; }
    #grouping-pane .label-buttons { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 8px 0; }
    #grouping-pane .label-buttons button.selected { outline: 3px solid var(--accent); }
    #grouping-pane .tuner-plot { width: 100%; height: 160px; background: #fbfcfe; border: 1px solid var(--line); border-radius: 8px; }
    #grouping-pane .slider-row { display: grid; grid-template-columns: 140px 1fr 70px; gap: 10px; align-items: center; margin: 10px 0; }
    #grouping-pane input[type="range"] { width: 100%; }
    #grouping-pane .metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
    #grouping-pane .basket-chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; margin: 0 6px 6px 0; background: var(--soft); font-size: 12px; }
`;

export function groupingPaneStyles(): string {
  return GROUPING_CSS;
}

export function defaultGroupingPaneState(): Record<string, unknown> {
  return {
    subtab: 'incidents',
    incidents: [],
    selectedIncidentId: null,
    pairs: [],
    articleHits: [],
    searchQ: '',
    basket: [],
    incidentName: '',
    adhocA: null,
    adhocB: null,
    adhocLabel: 'different_event',
    adhocReason: '',
    bulkReason: 'Gold incident: same real-world event across sources.',
    report: null,
    scoredPairs: [],
    attach: EMBEDDING_ATTACH_DISTANCE,
    uncertain: EMBEDDING_UNCERTAIN_DISTANCE,
    status: '',
  };
}

export function renderGroupingPane(): string {
  return `
  <section id="grouping-pane" hidden>
    <header style="height:auto;padding:10px 18px">
      <div class="tabs" role="tablist" aria-label="Grouping eval view">
        <button id="grp-tab-incidents" class="active" type="button">Gold incidents</button>
        <button id="grp-tab-adhoc" type="button">Ad-hoc pairs</button>
        <button id="grp-tab-tuner" type="button">Threshold tuner</button>
        <button id="grp-refresh" type="button">Refresh</button>
      </div>
    </header>
    <div id="grp-incidents-view">
      <div class="layout">
        <aside class="sidebar">
          <div class="summary" style="grid-template-columns:1fr">
            <div class="metric"><span class="muted">Gold incidents</span><strong id="grp-incident-count">0</strong></div>
          </div>
          <div id="grp-incident-list" class="item-list"></div>
        </aside>
        <main class="content">
          <div class="panel">
            <h2>Build a gold incident</h2>
            <p class="muted">Aim for ~3 DB articles about one real-world incident. Expand to pairs and bulk-label <code>same_event</code>.</p>
            <label class="muted">Name</label>
            <input id="grp-incident-name" style="width:100%;margin:6px 0 10px;padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="e.g. SailPoint GitHub July" />
            <label class="muted">Search articles in DB</label>
            <div style="display:flex;gap:8px;margin:6px 0">
              <input id="grp-article-search" style="flex:1;padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="title, URL, or source" />
              <button id="grp-article-search-btn" type="button">Search</button>
            </div>
            <div id="grp-article-hits" class="search-results"></div>
            <h3>Basket</h3>
            <div id="grp-basket"></div>
            <div class="actions">
              <button id="grp-new-incident" type="button">New gold incident</button>
              <button id="grp-save-incident" class="primary" type="button">Save gold incident</button>
              <button id="grp-bulk-same" type="button">Bulk-label pairs same_event</button>
            </div>
            <textarea id="grp-bulk-reason" placeholder="Reason for bulk same_event labels"></textarea>
            <p id="grp-incident-status" class="muted"></p>
          </div>
          <div class="panel">
            <h2>Expanded pairs</h2>
            <div id="grp-expanded-pairs"></div>
          </div>
        </main>
      </div>
    </div>
    <div id="grp-adhoc-view" style="display:none" class="content">
      <div class="panel">
        <h2>Ad-hoc pair</h2>
        <p class="muted">Pick two DB articles — typically <code>different_event</code> negatives.</p>
        <div class="grid">
          <div>
            <h3>Article A</h3>
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <input id="grp-adhoc-search-a" style="flex:1;padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="Search…" />
              <button id="grp-adhoc-search-a-btn" type="button">Search</button>
            </div>
            <div id="grp-adhoc-hits-a" class="search-results"></div>
            <div id="grp-adhoc-selected-a" class="muted" style="margin-top:8px">None selected</div>
          </div>
          <div>
            <h3>Article B</h3>
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <input id="grp-adhoc-search-b" style="flex:1;padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="Search…" />
              <button id="grp-adhoc-search-b-btn" type="button">Search</button>
            </div>
            <div id="grp-adhoc-hits-b" class="search-results"></div>
            <div id="grp-adhoc-selected-b" class="muted" style="margin-top:8px">None selected</div>
          </div>
        </div>
        <div class="label-buttons" id="grp-adhoc-labels">
          <button type="button" data-label="same_event">same_event</button>
          <button type="button" data-label="different_event" class="selected">different_event</button>
          <button type="button" data-label="uncertain">uncertain</button>
        </div>
        <textarea id="grp-adhoc-reason" placeholder="Why this label? (min 3 chars)"></textarea>
        <div class="actions"><button id="grp-adhoc-save" class="primary" type="button">Save pair label</button></div>
        <p id="grp-adhoc-status" class="muted"></p>
      </div>
    </div>
    <div id="grp-tuner-view" style="display:none" class="content">
      <div class="panel">
        <h2>Threshold tuner</h2>
        <p class="muted">Article↔article cosine distance. <code>uncertain</code> labels and missing/old embeddings are excluded from fitting. Suggestions are not applied to production config.</p>
        <div class="metrics-grid" id="grp-tuner-metrics"></div>
        <svg id="grp-tuner-plot" class="tuner-plot" viewBox="0 0 800 160" preserveAspectRatio="none"></svg>
        <div class="slider-row">
          <label for="grp-attach">Attach ≤</label>
          <input id="grp-attach" type="range" min="0" max="1" step="0.01" value="${EMBEDDING_ATTACH_DISTANCE}" />
          <strong id="grp-attach-val">${EMBEDDING_ATTACH_DISTANCE}</strong>
        </div>
        <div class="slider-row">
          <label for="grp-uncertain">Uncertain ≤</label>
          <input id="grp-uncertain" type="range" min="0" max="1" step="0.01" value="${EMBEDDING_UNCERTAIN_DISTANCE}" />
          <strong id="grp-uncertain-val">${EMBEDDING_UNCERTAIN_DISTANCE}</strong>
        </div>
        <p id="grp-tuner-suggest" class="muted"></p>
        <p id="grp-tuner-status" class="muted"></p>
      </div>
      <div class="panel">
        <h2>Scorable pairs</h2>
        <div id="grp-tuner-pairs"></div>
      </div>
    </div>
  </section>`;
}

export function groupingPaneBodyScript(): string {
  return `
    function initGroupingPane(state) {
      const g = state.grouping;
      function escapeHtml(value) {
        return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      }
      document.getElementById('grp-tab-incidents').addEventListener('click', () => switchGrpTab('incidents'));
      document.getElementById('grp-tab-adhoc').addEventListener('click', () => switchGrpTab('adhoc'));
      document.getElementById('grp-tab-tuner').addEventListener('click', () => switchGrpTab('tuner'));
      document.getElementById('grp-refresh').addEventListener('click', () => refreshGrouping());
      document.getElementById('grp-article-search-btn').addEventListener('click', () => searchArticles('basket'));
      document.getElementById('grp-article-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchArticles('basket'); });
      document.getElementById('grp-new-incident').addEventListener('click', startNewIncident);
      document.getElementById('grp-save-incident').addEventListener('click', saveIncident);
      document.getElementById('grp-bulk-same').addEventListener('click', bulkSame);
      document.getElementById('grp-adhoc-search-a-btn').addEventListener('click', () => searchArticles('a'));
      document.getElementById('grp-adhoc-search-b-btn').addEventListener('click', () => searchArticles('b'));
      document.getElementById('grp-adhoc-save').addEventListener('click', saveAdhoc);
      document.getElementById('grp-bulk-reason').value = g.bulkReason || '';
      document.querySelectorAll('#grp-adhoc-labels button').forEach((btn) => {
        btn.addEventListener('click', () => {
          g.adhocLabel = btn.getAttribute('data-label');
          document.querySelectorAll('#grp-adhoc-labels button').forEach((b) => b.classList.toggle('selected', b === btn));
        });
      });
      const attachEl = document.getElementById('grp-attach');
      const uncertainEl = document.getElementById('grp-uncertain');
      attachEl.addEventListener('input', () => { g.attach = Number(attachEl.value); document.getElementById('grp-attach-val').textContent = g.attach.toFixed(2); if (g.attach > g.uncertain) { g.uncertain = g.attach; uncertainEl.value = String(g.uncertain); document.getElementById('grp-uncertain-val').textContent = g.uncertain.toFixed(2); } loadReport(); });
      uncertainEl.addEventListener('input', () => { g.uncertain = Number(uncertainEl.value); document.getElementById('grp-uncertain-val').textContent = g.uncertain.toFixed(2); if (g.uncertain < g.attach) { g.attach = g.uncertain; attachEl.value = String(g.attach); document.getElementById('grp-attach-val').textContent = g.attach.toFixed(2); } loadReport(); });
      refreshGrouping();

      function switchGrpTab(tab) {
        g.subtab = tab;
        document.getElementById('grp-tab-incidents').classList.toggle('active', tab === 'incidents');
        document.getElementById('grp-tab-adhoc').classList.toggle('active', tab === 'adhoc');
        document.getElementById('grp-tab-tuner').classList.toggle('active', tab === 'tuner');
        document.getElementById('grp-incidents-view').style.display = tab === 'incidents' ? '' : 'none';
        document.getElementById('grp-adhoc-view').style.display = tab === 'adhoc' ? '' : 'none';
        document.getElementById('grp-tuner-view').style.display = tab === 'tuner' ? '' : 'none';
        if (tab === 'tuner') loadReport();
      }

      async function refreshGrouping() {
        const [incRes, pairRes] = await Promise.all([
          fetch('/api/grouping-eval/incidents'),
          fetch('/api/grouping-eval/pairs'),
        ]);
        const incData = await incRes.json();
        const pairData = await pairRes.json();
        g.incidents = incData.incidents || [];
        g.pairs = pairData.pairs || [];
        document.getElementById('grp-incident-count').textContent = String(g.incidents.length);
        renderIncidentList();
        renderBasket();
        renderExpanded();
        if (g.subtab === 'tuner') loadReport();
      }

      function renderIncidentList() {
        const list = document.getElementById('grp-incident-list');
        if (!g.incidents.length) { list.innerHTML = '<p class="empty">No gold incidents yet.</p>'; return; }
        list.innerHTML = g.incidents.map((inc) =>
          '<button type="button" class="item-button' + (g.selectedIncidentId === inc.id ? ' active' : '') + '" data-id="' + escapeHtml(inc.id) + '">' +
          '<div class="item-title">' + escapeHtml(inc.name) + '</div>' +
          '<div class="muted">' + inc.articles.length + ' articles</div></button>'
        ).join('');
        list.querySelectorAll('button').forEach((btn) => {
          btn.addEventListener('click', () => {
            const inc = g.incidents.find((i) => i.id === btn.getAttribute('data-id'));
            if (!inc) return;
            g.selectedIncidentId = inc.id;
            g.incidentName = inc.name;
            g.basket = inc.articles.slice();
            document.getElementById('grp-incident-name').value = inc.name;
            renderIncidentList();
            renderBasket();
            renderExpanded();
          });
        });
      }

      async function searchArticles(target) {
        const inputId = target === 'basket' ? 'grp-article-search' : (target === 'a' ? 'grp-adhoc-search-a' : 'grp-adhoc-search-b');
        const q = document.getElementById(inputId).value.trim();
        const res = await fetch('/api/grouping-eval/articles?q=' + encodeURIComponent(q) + '&limit=30');
        const data = await res.json();
        if (!res.ok) {
          setStatus(target === 'basket' ? 'grp-incident-status' : 'grp-adhoc-status', (data.error && data.error.message) || 'Search failed');
          return;
        }
        const hits = data.articles || [];
        const host = target === 'basket' ? 'grp-article-hits' : (target === 'a' ? 'grp-adhoc-hits-a' : 'grp-adhoc-hits-b');
        const el = document.getElementById(host);
        if (!hits.length) { el.innerHTML = '<p class="empty">No matches.</p>'; return; }
        el.innerHTML = hits.map((a) =>
          '<button type="button" class="item-button" data-id="' + escapeHtml(a.articleId) + '">' +
          '<div class="item-title">' + escapeHtml(a.title) + '</div>' +
          '<div class="muted">' + escapeHtml(a.sourceName) + (a.hasCurrentEmbedding ? '' : ' · no current embedding') + '</div></button>'
        ).join('');
        el.querySelectorAll('button').forEach((btn) => {
          btn.addEventListener('click', () => {
            const article = hits.find((h) => h.articleId === btn.getAttribute('data-id'));
            if (!article) return;
            if (target === 'basket') {
              if (!g.basket.some((b) => b.url === article.url)) g.basket.push(article);
              renderBasket();
              renderExpanded();
            } else if (target === 'a') {
              g.adhocA = article;
              document.getElementById('grp-adhoc-selected-a').textContent = article.title + ' — ' + article.sourceName;
            } else {
              g.adhocB = article;
              document.getElementById('grp-adhoc-selected-b').textContent = article.title + ' — ' + article.sourceName;
            }
          });
        });
      }

      function renderBasket() {
        const el = document.getElementById('grp-basket');
        if (!g.basket.length) { el.innerHTML = '<p class="muted">Empty basket.</p>'; return; }
        el.innerHTML = g.basket.map((a, idx) =>
          '<span class="basket-chip">' + escapeHtml(a.sourceName) + ': ' + escapeHtml(a.title.slice(0, 60)) +
          ' <button type="button" data-idx="' + idx + '">×</button></span>'
        ).join('');
        el.querySelectorAll('button').forEach((btn) => {
          btn.addEventListener('click', () => {
            g.basket.splice(Number(btn.getAttribute('data-idx')), 1);
            renderBasket();
            renderExpanded();
          });
        });
      }

      function expandPairs(urls) {
        const unique = [...new Set(urls)];
        const pairs = [];
        for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) pairs.push([unique[i], unique[j]]);
        return pairs;
      }

      function renderExpanded() {
        const el = document.getElementById('grp-expanded-pairs');
        const urls = g.basket.map((a) => a.url);
        const pairs = expandPairs(urls);
        if (!pairs.length) { el.innerHTML = '<p class="muted">Add at least two articles.</p>'; return; }
        el.innerHTML = pairs.map(([ua, ub]) => {
          const a = g.basket.find((x) => x.url === ua);
          const b = g.basket.find((x) => x.url === ub);
          const existing = (g.pairs || []).find((p) =>
            (p.urlA === ua && p.urlB === ub) || (p.urlA === ub && p.urlB === ua)
          );
          const label = existing ? existing.label : '';
          return '<div class="pair-row" data-ua="' + escapeHtml(ua) + '" data-ub="' + escapeHtml(ub) + '">' +
            '<div><strong>' + escapeHtml(a.title) + '</strong> <span class="muted">(' + escapeHtml(a.sourceName) + ')</span></div>' +
            '<div class="muted">' + escapeHtml(ua) + '</div>' +
            '<div style="margin:6px 0">×</div>' +
            '<div><strong>' + escapeHtml(b.title) + '</strong> <span class="muted">(' + escapeHtml(b.sourceName) + ')</span></div>' +
            '<div class="muted">' + escapeHtml(ub) + '</div>' +
            '<div class="muted" style="margin-top:6px">Current label: ' + (label ? escapeHtml(label) : 'none') + '</div>' +
            '<div class="label-buttons">' +
            '<button type="button" data-label="same_event">same_event</button>' +
            '<button type="button" data-label="different_event">different_event</button>' +
            '<button type="button" data-label="uncertain">uncertain</button>' +
            '</div></div>';
        }).join('');
        el.querySelectorAll('.pair-row').forEach((row) => {
          row.querySelectorAll('button[data-label]').forEach((btn) => {
            btn.addEventListener('click', () => labelExpandedPair(row.getAttribute('data-ua'), row.getAttribute('data-ub'), btn.getAttribute('data-label')));
          });
        });
      }

      async function labelExpandedPair(urlA, urlB, label) {
        const a = g.basket.find((x) => x.url === urlA);
        const b = g.basket.find((x) => x.url === urlB);
        const humanReason = document.getElementById('grp-bulk-reason').value.trim() || ('Pair override: ' + label);
        const res = await fetch('/api/grouping-eval/pairs?upsert=1', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            urlA, urlB, label, humanReason,
            goldIncidentId: g.selectedIncidentId || null,
            articleIdA: a && a.articleId, articleIdB: b && b.articleId,
            titleA: a && a.title, titleB: b && b.title,
            sourceNameA: a && a.sourceName, sourceNameB: b && b.sourceName,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setStatus('grp-incident-status', (data.error && data.error.message) || 'Label failed'); return; }
        setStatus('grp-incident-status', 'Updated pair label to ' + label);
        await refreshGrouping();
      }

      function startNewIncident() {
        g.selectedIncidentId = null;
        g.incidentName = '';
        g.basket = [];
        document.getElementById('grp-incident-name').value = '';
        document.getElementById('grp-article-hits').innerHTML = '';
        renderIncidentList();
        renderBasket();
        renderExpanded();
        setStatus('grp-incident-status', 'New gold incident — pick articles, then Save.');
      }

      async function saveIncident() {
        const name = document.getElementById('grp-incident-name').value.trim();
        if (!name) { setStatus('grp-incident-status', 'Name required'); return; }
        if (!g.basket.length) { setStatus('grp-incident-status', 'Add at least one article'); return; }
        const res = await fetch('/api/grouping-eval/incidents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: g.selectedIncidentId || undefined, name, articles: g.basket }),
        });
        const data = await res.json();
        if (!res.ok) { setStatus('grp-incident-status', (data.error && data.error.message) || 'Save failed'); return; }
        const wasUpdate = Boolean(g.selectedIncidentId);
        g.selectedIncidentId = data.incident.id;
        setStatus(
          'grp-incident-status',
          (wasUpdate ? 'Updated' : 'Created') + ' gold incident. Click “New gold incident” before starting another.'
        );
        await refreshGrouping();
      }

      async function bulkSame() {
        if (!g.selectedIncidentId) { setStatus('grp-incident-status', 'Save the gold incident first'); return; }
        const humanReason = document.getElementById('grp-bulk-reason').value.trim();
        if (humanReason.length < 3) { setStatus('grp-incident-status', 'Reason must be at least 3 characters'); return; }
        const res = await fetch('/api/grouping-eval/incidents/bulk-same', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ goldIncidentId: g.selectedIncidentId, humanReason }),
        });
        const data = await res.json();
        if (!res.ok) { setStatus('grp-incident-status', (data.error && data.error.message) || 'Bulk label failed'); return; }
        setStatus('grp-incident-status', 'Saved ' + data.savedCount + ' pairs' + (data.skippedCount ? ' (' + data.skippedCount + ' already labeled)' : ''));
        await refreshGrouping();
      }

      async function saveAdhoc() {
        if (!g.adhocA || !g.adhocB) { setStatus('grp-adhoc-status', 'Select both articles'); return; }
        const humanReason = document.getElementById('grp-adhoc-reason').value.trim();
        if (humanReason.length < 3) { setStatus('grp-adhoc-status', 'Reason required'); return; }
        const res = await fetch('/api/grouping-eval/pairs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            urlA: g.adhocA.url,
            urlB: g.adhocB.url,
            label: g.adhocLabel,
            humanReason,
            articleIdA: g.adhocA.articleId,
            articleIdB: g.adhocB.articleId,
            titleA: g.adhocA.title,
            titleB: g.adhocB.title,
            sourceNameA: g.adhocA.sourceName,
            sourceNameB: g.adhocB.sourceName,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setStatus('grp-adhoc-status', (data.error && data.error.message) || 'Save failed'); return; }
        setStatus('grp-adhoc-status', 'Pair saved.');
        await refreshGrouping();
      }

      async function loadReport() {
        const params = new URLSearchParams({ attach: String(g.attach), uncertain: String(g.uncertain) });
        const res = await fetch('/api/grouping-eval/report?' + params.toString());
        const data = await res.json();
        if (!res.ok) {
          document.getElementById('grp-tuner-status').textContent = (data.error && data.error.message) || 'Report failed';
          return;
        }
        g.report = data.report;
        g.scoredPairs = data.pairs || [];
        renderTuner();
      }

      function renderTuner() {
        const r = g.report;
        if (!r) return;
        document.getElementById('grp-tuner-metrics').innerHTML =
          metric('Labeled', r.counts.labeled) +
          metric('Scorable', r.counts.scorable) +
          metric('Not scorable', r.counts.unscorable) +
          metric('False attach', r.metrics.falseAttachCount) +
          metric('Same miss attach', r.metrics.sameEventMissAttachCount) +
          metric('Uncertain band', r.metrics.uncertainBandCount);
        document.getElementById('grp-tuner-suggest').textContent =
          'Production: attach=' + r.productionThresholds.attach + ', uncertain=' + r.productionThresholds.uncertain +
          ' · Suggested: attach=' + r.suggested.attach + ', uncertain=' + r.suggested.uncertain +
          ' (copy into config manually — not auto-applied)';
        document.getElementById('grp-tuner-status').textContent =
          r.counts.unscorable ? (r.counts.unscorable + ' labeled pairs waiting on current-model embeddings') : 'All labeled pairs scorable (or only uncertain/empty)';
        drawPlot(r.sameDistances, r.differentDistances, g.attach, g.uncertain);
        const list = document.getElementById('grp-tuner-pairs');
        list.innerHTML = (g.scoredPairs || []).map((p) =>
          '<div class="pair-row"><div><strong>' + escapeHtml(p.titleA || p.urlA) + '</strong> × <strong>' + escapeHtml(p.titleB || p.urlB) + '</strong></div>' +
          '<div class="muted">' + escapeHtml(p.label) + ' · distance=' + (p.distance == null ? 'n/a' : p.distance.toFixed(3)) + '</div></div>'
        ).join('') || '<p class="muted">No pairs labeled yet.</p>';
      }

      function metric(label, value) {
        return '<div class="metric"><span class="muted">' + label + '</span><strong>' + value + '</strong></div>';
      }

      function drawPlot(same, different, attach, uncertain) {
        const svg = document.getElementById('grp-tuner-plot');
        const w = 800, h = 160, pad = 20;
        const maxD = Math.max(1, attach, uncertain, ...(same || [0]), ...(different || [0]));
        const x = (d) => pad + (d / maxD) * (w - pad * 2);
        const dots = (arr, y, color) => (arr || []).map((d) => '<circle cx="' + x(d) + '" cy="' + y + '" r="5" fill="' + color + '" opacity="0.85" />').join('');
        svg.innerHTML =
          '<line x1="' + pad + '" y1="' + (h - 30) + '" x2="' + (w - pad) + '" y2="' + (h - 30) + '" stroke="#d8dee8" />' +
          '<line x1="' + x(attach) + '" y1="10" x2="' + x(attach) + '" y2="' + (h - 20) + '" stroke="#0f766e" stroke-dasharray="4 3" />' +
          '<line x1="' + x(uncertain) + '" y1="10" x2="' + x(uncertain) + '" y2="' + (h - 20) + '" stroke="#9a5b00" stroke-dasharray="4 3" />' +
          dots(same, 50, '#146c43') +
          dots(different, 100, '#b42318') +
          '<text x="' + pad + '" y="54" fill="#5f6b7a" font-size="12">same_event</text>' +
          '<text x="' + pad + '" y="104" fill="#5f6b7a" font-size="12">different_event</text>' +
          '<text x="' + x(attach) + '" y="14" fill="#0f766e" font-size="11">attach</text>' +
          '<text x="' + x(uncertain) + '" y="14" fill="#9a5b00" font-size="11">uncertain</text>';
      }

      function setStatus(id, text) {
        document.getElementById(id).textContent = text;
      }
    }
  `;
}
