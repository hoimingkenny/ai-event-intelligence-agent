/**
 * Single-file HTML/JS for the article monitoring portal. Kept framework-free
 * (matches the codebase trade-off of not adding a frontend framework before
 * the surface is proven). All dynamic values are inserted via textContent /
 * escaped in the client, never innerHTML from server data.
 */
export function renderPortalApp(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Vendor Threat Watch — Article Portal</title>
<style>
  :root { --bg:#0f1115; --panel:#181b22; --line:#262b36; --text:#e6e8ec; --muted:#8b93a3; --accent:#5b9dff; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--text); }
  header { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0; }
  .metrics { display:flex; gap:10px; flex-wrap:wrap; margin-left:auto; }
  .metric { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:6px 12px; }
  .metric .v { font-size:18px; font-weight:600; } .metric .k { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .controls { display:flex; gap:8px; padding:12px 20px; flex-wrap:wrap; align-items:center; border-bottom:1px solid var(--line); }
  select, input, button { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:6px 10px; font:inherit; }
  input#q { min-width:220px; }
  .layout { display:flex; height:calc(100vh - 132px); }
  .list { flex:1; overflow:auto; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--line); white-space:nowrap; }
  th { position:sticky; top:0; background:var(--bg); color:var(--muted); font-weight:500; font-size:12px; }
  tbody tr { cursor:pointer; } tbody tr:hover { background:#1d222c; } tbody tr.active { background:#232a38; }
  td.title { white-space:normal; max-width:420px; }
  td.desc { white-space:normal; min-width:320px; max-width:520px; }
  .pill { display:inline-block; padding:1px 8px; border-radius:20px; font-size:11px; border:1px solid var(--line); }
  .bar { display:inline-block; width:54px; height:8px; border-radius:4px; background:#2a2f3a; vertical-align:middle; overflow:hidden; }
  .bar > i { display:block; height:100%; }
  .muted { color:var(--muted); }
  .detail { width:44%; min-width:360px; border-left:1px solid var(--line); overflow:auto; padding:18px 20px; display:none; }
  .detail.open { display:block; }
  .detail h2 { font-size:15px; margin:0 0 4px; } .detail a { color:var(--accent); }
  .kv { display:grid; grid-template-columns:130px 1fr; gap:4px 10px; margin:14px 0; }
  .kv .muted { color:var(--muted); }
  .tag { display:inline-block; background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:2px 8px; margin:2px 4px 2px 0; font-size:12px; }
  .summary-mark { color:#3fb950; font-size:11px; margin-top:3px; }
  .fallback-mark { color:var(--muted); font-size:11px; margin-top:3px; }
  .channel { border:1px solid var(--line); border-radius:8px; padding:14px; background:var(--panel); margin-bottom:14px; }
  .channel h2 { margin:0 0 8px; font-size:18px; }
  .channel p { margin:0; }
  .tabs { display:flex; gap:8px; margin:14px 0 8px; }
  .tabs button.active { border-color:var(--accent); color:var(--accent); }
  .nav { display:flex; gap:6px; }
  .nav button { padding:6px 14px; }
  .nav button.active { border-color:var(--accent); color:var(--accent); font-weight:600; }
  .sev { text-transform:capitalize; }
  .sev.critical { color:#f85149; } .sev.high { color:#db6d28; } .sev.medium { color:#d29922; } .sev.low { color:#8b93a3; }
  .badge { background:#233; border:1px solid var(--accent); color:var(--accent); border-radius:20px; padding:1px 8px; font-size:11px; }
  .timeline { list-style:none; padding:0; margin:8px 0; }
  .timeline li { border-left:2px solid var(--line); padding:6px 0 6px 14px; margin-left:6px; position:relative; }
  .timeline li::before { content:''; position:absolute; left:-5px; top:11px; width:8px; height:8px; border-radius:50%; background:var(--accent); }
  .timeline li.first::before { background:#3fb950; } .timeline li.update::before { background:#d29922; }
  iframe { width:100%; height:420px; border:1px solid var(--line); border-radius:8px; background:#fff; }
  pre { white-space:pre-wrap; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px; max-height:420px; overflow:auto; }
  .empty { color:var(--muted); padding:40px; text-align:center; }
</style>
</head>
<body>
<header>
  <h1>Threat Watch Portal</h1>
  <div class="nav">
    <button id="navArticles" class="active">Articles</button>
    <button id="navEvents">Events</button>
  </div>
  <div class="metrics" id="metrics"></div>
</header>

<!-- ===== Articles page ===== -->
<div id="articlesPage">
<div class="controls">
  <input id="q" placeholder="Search title or URL…" />
  <select id="status"><option value="">All statuses</option></select>
  <select id="source"><option value="">All sources</option></select>
  <select id="sort">
    <option value="recent">Newest first</option>
    <option value="vendor_desc">Most vendor-relevant first</option>
    <option value="quality_asc">Lowest quality first</option>
    <option value="recall_asc">Lowest recall first</option>
  </select>
  <button id="refresh">Refresh</button>
  <span class="muted" id="count"></span>
</div>
<div class="layout">
  <div class="list">
    <table>
      <thead><tr>
        <th>Title</th><th>Source</th><th>Vendor (closest)</th><th>Status</th><th>Extraction</th>
        <th>Quality</th><th>RSS recall</th><th>Chars</th><th>Published</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty" id="listEmpty" style="display:none">No articles match.</div>
  </div>
  <div class="detail" id="detail"></div>
</div>
</div>

<!-- ===== Events page ===== -->
<div id="eventsPage" style="display:none">
<div class="controls">
  <input id="eq" placeholder="Search event title…" />
  <select id="esev"><option value="">All severities</option>
    <option value="critical">critical</option><option value="high">high</option>
    <option value="medium">medium</option><option value="low">low</option></select>
  <label class="muted"><input type="checkbox" id="emulti" /> Multi-source only</label>
  <select id="esort">
    <option value="sources_desc">Most sources first</option>
    <option value="recent">Most recent</option>
    <option value="severity">Severity</option>
  </select>
  <button id="erefresh">Refresh</button>
  <span class="muted" id="ecount"></span>
</div>
<div class="layout">
  <div class="list">
    <table>
      <thead><tr>
        <th>Description</th><th>Vendor/Product</th><th>Severity</th><th>Confidence</th><th>Sources</th><th>First seen · Last update</th>
      </tr></thead>
      <tbody id="erows"></tbody>
    </table>
    <div class="empty" id="eventsEmpty" style="display:none">No events match.</div>
  </div>
  <div class="detail" id="edetail"></div>
</div>
</div>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
const pct = (v) => v == null ? '—' : Math.round(v * 100) + '%';
const scoreColor = (v) => v == null ? '#555' : v >= 0.7 ? '#3fb950' : v >= 0.4 ? '#d29922' : '#f85149';
const dt = (v) => v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '—';
const rel = (v) => {
  if (!v) return '—';
  const diff = Date.now() - new Date(v).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 48) return hours + 'h ago';
  return Math.round(hours / 24) + 'd ago';
};
let activeId = null;

function bar(v) {
  if (v == null) return '<span class="muted">—</span>';
  return '<span class="bar"><i style="width:' + Math.round(v*100) + '%;background:' + scoreColor(v) + '"></i></span> ' + pct(v);
}

// Closest monitored vendor + how strongly the article relates to it.
function vendorCell(vendor, relevance) {
  if (!vendor) return '<span class="muted">none</span>';
  return '<strong>' + esc(vendor) + '</strong> ' + bar(relevance);
}

function chips(values) {
  return (values || []).map(v => '<span class="tag">' + esc(v) + '</span>').join('');
}

async function loadList() {
  const p = new URLSearchParams();
  if ($('q').value) p.set('q', $('q').value);
  if ($('status').value) p.set('status', $('status').value);
  if ($('source').value) p.set('source', $('source').value);
  p.set('sort', $('sort').value);
  const data = await fetch('/api/articles?' + p).then(r => r.json());
  renderMetrics(data.summary);
  fillOnce($('status'), data.statuses, 'All statuses');
  fillOnce($('source'), data.sources, 'All sources');
  $('count').textContent = data.filtered + ' of ' + data.summary.total + ' articles';
  const rows = $('rows'); rows.innerHTML = '';
  $('listEmpty').style.display = data.items.length ? 'none' : 'block';
  for (const a of data.items) {
    const tr = document.createElement('tr');
    if (a.id === activeId) tr.className = 'active';
    tr.innerHTML =
      '<td class="title">' + esc(a.title || '(untitled)') + '</td>' +
      '<td class="muted">' + esc(a.sourceName || '—') + '</td>' +
      '<td>' + vendorCell(a.topVendor, a.vendorRelevance) + '</td>' +
      '<td><span class="pill">' + esc(a.processingStatus) + '</span></td>' +
      '<td class="muted">' + esc(a.extractionStatus) + '</td>' +
      '<td>' + bar(a.contentQualityScore) + '</td>' +
      '<td>' + bar(a.rssRecall) + '</td>' +
      '<td class="muted">' + a.cleanTextLength + '</td>' +
      '<td class="muted">' + dt(a.publishedAt) + '</td>';
    tr.onclick = () => openDetail(a.id);
    rows.appendChild(tr);
  }
}

function renderMetricsList(pairs) {
  $('metrics').innerHTML = pairs.map(([k,v]) =>
    '<div class="metric"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k) + '</div></div>').join('');
}
function renderMetrics(s) {
  renderMetricsList([
    ['Articles', s.total],
    ['Median quality', pct(s.medianQuality)],
    ['Median recall', pct(s.medianRssRecall)],
    ['Extraction fails', pct(s.extractionFailureRate)],
  ]);
}

function fillOnce(sel, values, allLabel) {
  if (sel.dataset.filled) return;
  for (const v of values) { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); }
  sel.dataset.filled = '1';
}

async function openDetail(id) {
  activeId = id;
  document.querySelectorAll('#rows tr').forEach(tr => tr.classList.remove('active'));
  const a = await fetch('/api/articles/' + id).then(r => r.json());
  const d = $('detail'); d.classList.add('open');
  const entities = a.entities.length
    ? a.entities.map(e => '<span class="tag">' + esc(e.entityType) + ': ' + esc(e.entityValue) +
        ' <span class="muted">' + pct(e.confidence) + '</span></span>').join('')
    : '<span class="muted">none</span>';
  const events = a.events.length
    ? a.events.map(e => '<span class="tag evlink" data-ev="' + esc(e.eventId) + '" style="cursor:pointer">#' + esc(e.eventId) + ' ' + esc(e.relationship || '') +
        ' <span class="muted">' + esc(e.severity || '') + ' ' + pct(e.confidence) + '</span></span>').join('')
    : '<span class="muted">not grouped</span>';
  const alerts = a.alerts.length
    ? a.alerts.map(al => '<span class="tag">' + esc(al.alertTier || '') + ' / ' + esc(al.alertStatus || '') +
        (al.suppressed ? ' <span class="muted">suppressed</span>' : '') + '</span>').join('')
    : '<span class="muted">no alerts</span>';

  d.innerHTML =
    '<h2>' + esc(a.title || '(untitled)') + '</h2>' +
    (a.canonicalUrl ? '<a href="' + esc(a.canonicalUrl) + '" target="_blank" rel="noopener">' + esc(a.canonicalUrl) + '</a>' : '') +
    '<div class="kv">' +
      kv('Vendor (closest)', vendorCell(a.topVendor, a.vendorRelevance)) +
      kv('Status', a.processingStatus) + kv('Extraction', a.extractionStatus + (a.extractionMethod ? ' (' + a.extractionMethod + ')' : '')) +
      kv('Quality', bar(a.contentQualityScore)) + kv('RSS recall', bar(a.rssRecall)) +
      kv('Clean chars', a.cleanTextLength) + kv('Source', a.sourceName || '—') +
      kv('Published', dt(a.publishedAt)) + kv('Fetched', dt(a.fetchedAt)) +
      (a.extractionError ? kv('Error', '<span style="color:#f85149">' + esc(a.extractionError) + '</span>') : '') +
    '</div>' +
    '<div><strong>Entities</strong><br>' + entities + '</div>' +
    '<div style="margin-top:10px"><strong>Events</strong><br>' + events + '</div>' +
    '<div style="margin-top:10px"><strong>Alerts</strong><br>' + alerts + '</div>' +
    '<div class="tabs">' +
      '<button id="tabExtracted" class="active">Extracted</button>' +
      '<button id="tabRss">RSS summary</button>' +
      '<button id="tabClassification">Classification</button>' +
    '</div>' +
    '<div id="pane"></div>';

  const panes = {
    tabExtracted: () => '<iframe sandbox="" src="/api/articles/' + id + '/preview"></iframe>',
    tabRss: () => '<pre>' + esc(a.rssSummary || '(none)') + '</pre>',
    tabClassification: () => '<pre>' + esc(a.llmClassification ? JSON.stringify(a.llmClassification, null, 2) : '(not classified)') + '</pre>',
  };
  const showPane = (key) => {
    $('pane').innerHTML = panes[key]();
    ['tabExtracted','tabRss','tabClassification'].forEach(t => $(t).classList.toggle('active', t === key));
  };
  $('tabExtracted').onclick = () => showPane('tabExtracted');
  $('tabRss').onclick = () => showPane('tabRss');
  $('tabClassification').onclick = () => showPane('tabClassification');
  showPane('tabExtracted');
  // Event chips jump to the Events page and open that event.
  d.querySelectorAll('.evlink').forEach(el => el.onclick = () => { showPage('events'); openEvent(el.dataset.ev); });
  loadList();
}

function kv(k, v) { return '<div class="muted">' + esc(k) + '</div><div>' + v + '</div>'; }

// ===== Events =====
let activeEventId = null;

async function loadEvents() {
  const p = new URLSearchParams();
  if ($('eq').value) p.set('q', $('eq').value);
  if ($('esev').value) p.set('severity', $('esev').value);
  if ($('emulti').checked) p.set('minSources', '2');
  p.set('sort', $('esort').value);
  const data = await fetch('/api/events?' + p).then(r => r.json());
  if (currentPage === 'events') renderEventMetrics(data.summary);
  $('ecount').textContent = data.filtered + ' of ' + data.summary.total + ' events';
  const rows = $('erows'); rows.innerHTML = '';
  $('eventsEmpty').style.display = data.items.length ? 'none' : 'block';
  for (const e of data.items) {
    const tr = document.createElement('tr');
    if (e.id === activeEventId) tr.className = 'active';
    const multi = e.sourceCount > 1 ? ' <span class="badge">' + e.sourceCount + ' sources</span>' : '';
    const descriptionMark = e.hasLlmSummary
      ? '<div class="summary-mark">LLM summary</div>'
      : '<div class="fallback-mark">draft title</div>';
    const vendorProduct = chips(e.affectedVendors).concat(chips(e.affectedProducts)) || '<span class="muted">—</span>';
    tr.innerHTML =
      '<td class="desc"><strong>' + esc(e.eventTitle || '(untitled)') + '</strong>' + descriptionMark + '</td>' +
      '<td>' + vendorProduct + '</td>' +
      '<td><span class="sev ' + esc(e.severity || '') + '">' + esc(e.severity || '—') + '</span></td>' +
      '<td>' + bar(e.confidence) + '</td>' +
      '<td>' + e.sourceCount + multi + '</td>' +
      '<td class="muted">' + rel(e.firstSeenAt) + ' · ' + rel(e.lastSeenAt) +
        '<br><span class="muted">' + dt(e.firstSeenAt) + ' · ' + dt(e.lastSeenAt) + '</span></td>';
    tr.onclick = () => openEvent(e.id);
    rows.appendChild(tr);
  }
}

function renderEventMetrics(s) {
  renderMetricsList([
    ['Events', s.total],
    ['Multi-source', s.multiSource],
    ['Critical', (s.bySeverity && s.bySeverity.critical) || 0],
    ['High', (s.bySeverity && s.bySeverity.high) || 0],
  ]);
}

async function openEvent(id) {
  activeEventId = id;
  const e = await fetch('/api/events/' + id).then(r => r.json());
  const d = $('edetail'); d.classList.add('open');
  const vendors = (e.affectedVendors || []).map(v => '<span class="tag">' + esc(v) + '</span>').join('') || '<span class="muted">—</span>';
  const products = (e.affectedProducts || []).map(v => '<span class="tag">' + esc(v) + '</span>').join('') || '<span class="muted">—</span>';
  const cves = (e.cves || []).map(c => '<span class="tag">' + esc(c) + '</span>').join('') || '<span class="muted">—</span>';

  // Sources as a timeline: first report → follow-ups (server orders by published time).
  const sources = e.sources.length ? e.sources.map((s, i) => {
    const cls = i === 0 ? 'first' : (s.isMaterialUpdate ? 'update' : '');
    const link = s.canonicalUrl ? '<a href="' + esc(s.canonicalUrl) + '" target="_blank" rel="noopener">' + esc(s.title || s.canonicalUrl) + '</a>' : esc(s.title || '(untitled)');
    const flags = (s.isPrimarySource ? ' <span class="badge">primary</span>' : '') +
                  (i === 0 ? ' <span class="muted">first report</span>' : '') +
                  (s.isMaterialUpdate ? ' <span class="sev medium">material update</span>' : '');
    return '<li class="' + cls + '"><div>' + dt(s.publishedAt) + ' · <strong>' + esc(s.sourceName || '—') + '</strong>' + flags + '</div>' +
           '<div>' + link + ' <a class="muted" href="/api/articles/' + esc(s.articleId) + '/preview" target="_blank">[extracted]</a></div></li>';
  }).join('') : '<li class="muted">No sources.</li>';

  d.innerHTML =
    '<div class="channel">' +
      '<h2>' + esc(e.eventTitle || '(untitled)') + '</h2>' +
      (e.eventSummary ? '<p class="muted">' + esc(e.eventSummary) + '</p>' : '<p class="muted">No LLM event summary yet. The draft title is shown until the summary stage runs.</p>') +
      (e.hasLlmSummary ? '<div class="summary-mark">Generated event payload</div>' : '<div class="fallback-mark">Fallback event draft</div>') +
    '</div>' +
    '<div class="kv">' +
      kv('Severity', '<span class="sev ' + esc(e.severity || '') + '">' + esc(e.severity || '—') + '</span>') +
      kv('Urgency', e.urgency || '—') + kv('Confidence', bar(e.confidence)) +
      kv('Sources', e.sourceCount) + kv('Status', e.eventStatus) +
      kv('Grouping key', '<code>' + esc(e.groupingKey || '—') + '</code>') +
      kv('First seen', dt(e.firstSeenAt)) + kv('Last seen', dt(e.lastSeenAt)) +
    '</div>' +
    '<div><strong>Vendors</strong><br>' + vendors + '</div>' +
    '<div style="margin-top:10px"><strong>Products</strong><br>' + products + '</div>' +
    '<div style="margin-top:10px"><strong>CVEs</strong><br>' + cves + '</div>' +
    '<div style="margin-top:12px"><strong>Sources of this event (' + e.sources.length + ')</strong>' +
      '<ul class="timeline">' + sources + '</ul></div>';
  loadEvents();
}

// ===== Page navigation =====
let currentPage = 'articles';
function showPage(page) {
  currentPage = page;
  $('articlesPage').style.display = page === 'articles' ? 'block' : 'none';
  $('eventsPage').style.display = page === 'events' ? 'block' : 'none';
  $('navArticles').classList.toggle('active', page === 'articles');
  $('navEvents').classList.toggle('active', page === 'events');
  if (page === 'articles') loadList(); else loadEvents();
}

$('refresh').onclick = loadList;
$('sort').onchange = loadList;
$('status').onchange = loadList;
$('source').onchange = loadList;
let t; $('q').oninput = () => { clearTimeout(t); t = setTimeout(loadList, 250); };
$('navArticles').onclick = () => showPage('articles');
$('navEvents').onclick = () => showPage('events');
$('erefresh').onclick = loadEvents;
$('esort').onchange = loadEvents;
$('esev').onchange = loadEvents;
$('emulti').onchange = loadEvents;
let et; $('eq').oninput = () => { clearTimeout(et); et = setTimeout(loadEvents, 250); };
loadList();
</script>
</body>
</html>`;
}
