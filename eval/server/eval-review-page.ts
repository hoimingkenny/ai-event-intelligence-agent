export function renderEvalReviewApp(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cheap Filter Eval Review</title>
  <style>
    :root {
      --bg: #f7f8fa; --surface: #ffffff; --soft: #eef2f6; --line: #d8dee8;
      --text: #17202a; --muted: #5f6b7a; --accent: #0f766e; --accent-dark: #0b5d57;
      --warn: #9a5b00; --bad: #b42318; --good: #146c43;
    }
    * { box-sizing: border-box; }
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
    .layout { display: grid; grid-template-columns: 360px 1fr; min-height: calc(100vh - 60px); }
    .sidebar { border-right: 1px solid var(--line); background: var(--surface); min-width: 0; }
    .summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 12px; border-bottom: 1px solid var(--line); }
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
    a { color: var(--accent); }
    @media (max-width: 980px) { .layout { grid-template-columns: 1fr; } .item-list { max-height: 320px; } }
  </style>
</head>
<body>
  <header>
    <h1>Cheap Filter Eval Review</h1>
    <div class="tabs">
      <button id="tab-label" class="active">Label candidates</button>
      <button id="tab-live">Live decisions</button>
      <button id="tab-report">Report</button>
      <button id="refresh">Refresh</button>
    </div>
  </header>
  <div id="live-view" class="layout" style="display:none">
    <aside class="sidebar">
      <div id="live-summary" class="summary"></div>
      <div style="padding:10px 12px;border-bottom:1px solid var(--line)">
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
  <script>
    const state = {
      tab: 'label',
      candidates: [], pendingCount: 0, labeledCount: 0, selectedCandidateId: null,
      pickedLabel: null,
      report: null, selectedResultId: null, resultFilter: 'failures',
      live: null, selectedArticleId: null, livePickedLabel: null,
    };
    const LABELS = [
      { value: 'CRITICAL_RELEVANT', text: 'Critical', cls: 'lbl-critical', hint: 'Must be KEPT (active exploitation, KEV, monitored product hit)' },
      { value: 'RELEVANT', text: 'Relevant', cls: 'lbl-relevant', hint: 'Should at least survive as MAYBE_KEEP' },
      { value: 'WEAK_RELEVANT', text: 'Weak', cls: 'lbl-weak', hint: 'Tangential; MAYBE_KEEP acceptable' },
      { value: 'IRRELEVANT', text: 'Irrelevant', cls: 'lbl-irrelevant', hint: 'Should be DROPPED' },
    ];
    const SEVERITY_RANK = { severe: 0, high: 1, medium: 2, low: 3 };

    document.getElementById('tab-label').addEventListener('click', () => switchTab('label'));
    document.getElementById('tab-live').addEventListener('click', () => switchTab('live'));
    document.getElementById('tab-report').addEventListener('click', () => switchTab('report'));
    document.getElementById('refresh').addEventListener('click', loadAll);
    document.getElementById('live-filter').addEventListener('change', loadLive);
    document.getElementById('live-limit').addEventListener('change', loadLive);
    loadAll();

    function switchTab(tab) {
      state.tab = tab;
      document.getElementById('tab-label').classList.toggle('active', tab === 'label');
      document.getElementById('tab-live').classList.toggle('active', tab === 'live');
      document.getElementById('tab-report').classList.toggle('active', tab === 'report');
      document.getElementById('label-view').style.display = tab === 'label' ? '' : 'none';
      document.getElementById('live-view').style.display = tab === 'live' ? '' : 'none';
      document.getElementById('report-view').style.display = tab === 'report' ? '' : 'none';
    }

    async function loadAll() {
      await Promise.all([loadCandidates(), loadReport(), loadLive()]);
    }

    // ---------- Live decisions tab ----------

    async function loadLive() {
      const decision = document.getElementById('live-filter').value;
      const limit = document.getElementById('live-limit').value;
      const response = await fetch('/api/decisions?decision=' + encodeURIComponent(decision) + '&limit=' + encodeURIComponent(limit));
      state.live = await response.json();
      if (state.live.enabled && !state.live.articles.some((a) => a.articleId === state.selectedArticleId)) {
        state.selectedArticleId = state.live.articles[0]?.articleId ?? null;
      }
      state.livePickedLabel = null;
      renderLiveView();
    }

    function renderLiveView() {
      const live = state.live;
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
        const active = a.articleId === state.selectedArticleId ? ' active' : '';
        return '<button class="item-button' + active + '" data-id="' + escapeAttr(a.articleId) + '">' +
          '<div class="item-title">' + escapeHtml(a.title) + '</div>' +
          '<div class="muted">' + escapeHtml(a.sourceName) + ' · ' + formatDate(a.publishedAt) + '</div>' +
          '<div class="badges">' + decisionBadge(a.decision) + badge('score ' + (a.score ?? 'n/a')) +
            (a.alreadyLabeled ? badge('in dataset', 'good') : '') + '</div>' +
        '</button>';
      }).join('');
      for (const button of list.querySelectorAll('.item-button')) {
        button.addEventListener('click', () => { state.selectedArticleId = button.dataset.id; state.livePickedLabel = null; renderLiveView(); });
      }
      renderLiveDetail(live.articles.find((a) => a.articleId === state.selectedArticleId));
    }

    function renderLiveDetail(article) {
      const detail = document.getElementById('live-detail');
      if (!article) { detail.innerHTML = '<p class="empty">Nothing selected.</p>'; return; }
      const labelPanel = article.alreadyLabeled
        ? panel('Your judgement', '<p class="muted">Already in the eval dataset. See the Report tab for how the filter scores it.</p>')
        : panel('Add to eval dataset',
            '<div class="label-buttons">' + LABELS.map((l) =>
              '<button type="button" class="' + l.cls + (state.livePickedLabel === l.value ? ' selected' : '') + '" data-label="' + l.value + '" title="' + escapeAttr(l.hint) + '">' + l.text + '</button>'
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
          state.livePickedLabel = button.dataset.label;
          for (const other of detail.querySelectorAll('.label-buttons button')) other.classList.toggle('selected', other === button);
          document.getElementById('live-label-hint').textContent = LABELS.find((l) => l.value === state.livePickedLabel)?.hint ?? '';
        });
      }
      const save = document.getElementById('live-save');
      if (save) save.addEventListener('click', () => saveLiveLabel(article));
    }

    async function saveLiveLabel(article) {
      const status = document.getElementById('live-status');
      const reason = document.getElementById('live-reason').value.trim();
      if (!state.livePickedLabel) { status.textContent = 'Pick a label first.'; return; }
      if (reason.length < 3) { status.textContent = 'Add a short reason (min 3 chars).'; return; }
      status.textContent = 'Saving...';
      const response = await fetch('/api/labels/from-article', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articleId: article.articleId, humanLabel: state.livePickedLabel, humanReason: reason }),
      });
      if (!response.ok) {
        const error = await response.json();
        status.textContent = error.error?.message || 'Failed to save.';
        return;
      }
      await Promise.all([loadLive(), loadReport(), loadCandidates()]);
    }

    async function loadCandidates() {
      const response = await fetch('/api/candidates');
      const data = await response.json();
      state.candidates = data.candidates;
      state.pendingCount = data.pendingCount;
      state.labeledCount = data.labeledCount;
      if (!state.candidates.some((c) => c.id === state.selectedCandidateId)) {
        state.selectedCandidateId = state.candidates[0]?.id ?? null;
      }
      state.pickedLabel = null;
      renderLabelView();
    }

    async function loadReport() {
      const response = await fetch('/api/report');
      state.report = await response.json();
      renderReportView();
    }

    // ---------- Labeling tab ----------

    function renderLabelView() {
      document.getElementById('label-summary').innerHTML =
        metric('To label', state.pendingCount) + metric('In dataset', state.labeledCount);
      const list = document.getElementById('candidate-list');
      if (state.candidates.length === 0) {
        list.innerHTML = '<p class="empty">No pending candidates. Run <code>npm run eval:candidates</code> to harvest more from the pipeline.</p>';
        document.getElementById('label-detail').innerHTML = '<p class="empty">Nothing to label.</p>';
        return;
      }
      list.innerHTML = state.candidates.map((c) => {
        const active = c.id === state.selectedCandidateId ? ' active' : '';
        return '<button class="item-button' + active + '" data-id="' + escapeAttr(c.id) + '">' +
          '<div class="item-title">' + escapeHtml(c.title) + '</div>' +
          '<div class="muted">' + escapeHtml(c.sourceName) + ' · ' + formatDate(c.publishedAt) + '</div>' +
          '<div class="badges">' + decisionBadge(c.harvest.decision) + badge('score ' + (c.harvest.score ?? 'n/a')) + badge(c.sourceTier) + '</div>' +
        '</button>';
      }).join('');
      for (const button of list.querySelectorAll('.item-button')) {
        button.addEventListener('click', () => { state.selectedCandidateId = button.dataset.id; state.pickedLabel = null; renderLabelView(); });
      }
      renderLabelDetail(state.candidates.find((c) => c.id === state.selectedCandidateId));
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
            '<button type="button" class="' + l.cls + (state.pickedLabel === l.value ? ' selected' : '') + '" data-label="' + l.value + '" title="' + escapeAttr(l.hint) + '">' + l.text + '</button>'
          ).join('') + '</div>' +
          '<div class="muted" id="label-hint">' + escapeHtml(LABELS.find((l) => l.value === state.pickedLabel)?.hint ?? 'Pick a label; hover for what each implies.') + '</div>' +
          '<h3>Why? (saved as humanReason)</h3>' +
          '<textarea id="reason" placeholder="e.g. Actively exploited zero-day in monitored CyberArk PAM"></textarea>' +
          '<div class="actions"><button class="primary" id="save-label">Save &amp; next</button><span id="label-status" class="muted"></span></div>');
      for (const button of detail.querySelectorAll('.label-buttons button')) {
        button.addEventListener('click', () => {
          state.pickedLabel = button.dataset.label;
          for (const other of detail.querySelectorAll('.label-buttons button')) other.classList.toggle('selected', other === button);
          document.getElementById('label-hint').textContent = LABELS.find((l) => l.value === state.pickedLabel)?.hint ?? '';
        });
      }
      document.getElementById('save-label').addEventListener('click', () => saveLabel(candidate));
    }

    async function saveLabel(candidate) {
      const status = document.getElementById('label-status');
      const reason = document.getElementById('reason').value.trim();
      if (!state.pickedLabel) { status.textContent = 'Pick a label first.'; return; }
      if (reason.length < 3) { status.textContent = 'Add a short reason (min 3 chars).'; return; }
      status.textContent = 'Saving...';
      const response = await fetch('/api/labels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId: candidate.id, humanLabel: state.pickedLabel, humanReason: reason }),
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
      const report = state.report;
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
      const shown = state.resultFilter === 'all' ? report.results : failures;
      const list = document.getElementById('result-list');
      list.innerHTML =
        '<div style="padding:10px 12px;border-bottom:1px solid var(--line)"><select id="result-filter">' +
          '<option value="failures"' + (state.resultFilter === 'failures' ? ' selected' : '') + '>Failures (' + failures.length + ')</option>' +
          '<option value="all"' + (state.resultFilter === 'all' ? ' selected' : '') + '>All samples (' + report.results.length + ')</option>' +
        '</select></div>' +
        (shown.length === 0 ? '<p class="empty">No failures. Nice.</p>' : shown.map((r) => {
          const active = r.id === state.selectedResultId ? ' active' : '';
          return '<button class="item-button' + active + '" data-id="' + escapeAttr(r.id) + '">' +
            '<div class="item-title">' + escapeHtml(r.title) + '</div>' +
            '<div class="badges">' + labelBadge(r.humanLabel) + decisionBadge(r.decision) +
              (r.severity ? badge(r.severity, r.severity === 'severe' || r.severity === 'high' ? 'bad' : 'warn') : badge('ok', 'good')) +
            '</div></button>';
        }).join(''));
      document.getElementById('result-filter').addEventListener('change', (event) => {
        state.resultFilter = event.target.value; renderReportView();
      });
      for (const button of list.querySelectorAll('.item-button')) {
        button.addEventListener('click', () => { state.selectedResultId = button.dataset.id; renderReportView(); });
      }
      renderReportDetail(report, report.results.find((r) => r.id === state.selectedResultId) ?? null);
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
  </script>
</body>
</html>`;
}
