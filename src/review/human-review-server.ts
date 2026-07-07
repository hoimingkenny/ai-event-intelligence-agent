import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { ZodError } from 'zod';
import type { Queryable } from '../db/repositories/types.js';
import {
  HumanReviewValidationError,
  HumanReviewSubmissionSchema,
  loadHumanReviewDashboard,
  saveHumanReviewVerdict,
} from './human-review-dashboard.js';
import { loadLlmEvaluationDashboard } from './llm-evaluation-dashboard.js';

const MAX_REVIEW_CASE_LIMIT = 200;
const MAX_JSON_BODY_BYTES = 64 * 1024;

export interface HumanReviewServerOptions {
  host?: string;
  port?: number;
  defaultLimit?: number;
}

export async function startHumanReviewServer(
  db: Queryable,
  options: HumanReviewServerOptions = {}
): Promise<http.Server> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4321;
  const server = createHumanReviewServer(db, options);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
}

export function createHumanReviewServer(db: Queryable, options: HumanReviewServerOptions = {}): http.Server {
  return http.createServer(async (req, res) => {
    try {
      await routeRequest(db, req, res, options);
    } catch (error) {
      sendError(res, error);
    }
  });
}

async function routeRequest(
  db: Queryable,
  req: IncomingMessage,
  res: ServerResponse,
  options: HumanReviewServerOptions
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    sendHtml(res, renderReviewApp());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/review-cases') {
    const limit = clampLimit(Number(url.searchParams.get('limit') ?? options.defaultLimit ?? 50));
    const dashboard = await loadHumanReviewDashboard(db, limit);
    sendJson(res, dashboard);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/llm-evaluations') {
    const limit = clampLimit(Number(url.searchParams.get('limit') ?? 20));
    const dashboard = await loadLlmEvaluationDashboard(db, {
      limit,
      runId: url.searchParams.get('runId') ?? undefined,
    });
    sendJson(res, dashboard);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reviews') {
    const body = await readJson(req);
    const input = HumanReviewSubmissionSchema.parse(body);
    const verdict = await saveHumanReviewVerdict(db, input);
    sendJson(res, { verdict }, 201);
    return;
  }

  sendJson(res, { error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_JSON_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof PayloadTooLargeError) {
    sendJson(res, { error: { code: 'PAYLOAD_TOO_LARGE', message: error.message } }, 413);
    return;
  }

  if (error instanceof HumanReviewValidationError) {
    sendJson(res, { error: { code: 'VALIDATION_ERROR', message: error.message } }, 422);
    return;
  }

  if (error instanceof SyntaxError || error instanceof ZodError) {
    sendJson(
      res,
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Review input is invalid',
          details: error instanceof ZodError ? error.flatten() : undefined,
        },
      },
      422
    );
    return;
  }

  console.error(error);
  sendJson(res, { error: { code: 'SERVER_ERROR', message: 'Unexpected server error' } }, 500);
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(MAX_REVIEW_CASE_LIMIT, Math.trunc(limit)));
}

class PayloadTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_JSON_BODY_BYTES} bytes.`);
    this.name = 'PayloadTooLargeError';
  }
}

export function renderReviewApp(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vendor Threat Watch Review</title>
  <style>
    :root {
      --bg: #f7f8fa;
      --surface: #ffffff;
      --soft: #eef2f6;
      --line: #d8dee8;
      --text: #17202a;
      --muted: #5f6b7a;
      --accent: #0f766e;
      --accent-dark: #0b5d57;
      --warn: #9a5b00;
      --bad: #b42318;
      --good: #146c43;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { height: 60px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--line); background: var(--surface); }
    h1 { margin: 0; font-size: 18px; letter-spacing: 0; }
    h2 { margin: 0 0 10px; font-size: 15px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0; }
    button, select, input, textarea { font: inherit; }
    button { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 7px 10px; cursor: pointer; }
    button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    button.primary:hover { background: var(--accent-dark); }
    .tabs { display: inline-flex; gap: 6px; margin-right: 8px; }
    .tab { min-width: 118px; }
    .tab.active { background: #e9f6f4; border-color: #95cfc7; color: var(--accent-dark); font-weight: 650; }
    .layout { display: grid; grid-template-columns: 360px 1fr; min-height: calc(100vh - 60px); }
    .sidebar { border-right: 1px solid var(--line); background: var(--surface); min-width: 0; }
    .filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px; border-bottom: 1px solid var(--line); }
    .summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 12px; border-bottom: 1px solid var(--line); }
    .metric { border: 1px solid var(--line); border-radius: 6px; padding: 8px; background: #fbfcfd; }
    .metric strong { display: block; font-size: 20px; line-height: 1.1; }
    .case-list { max-height: calc(100vh - 230px); overflow: auto; }
    .case-button { width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 11px 12px; background: var(--surface); }
    .case-button.active { background: #e9f6f4; box-shadow: inset 3px 0 0 var(--accent); }
    .case-title { font-weight: 650; overflow-wrap: anywhere; }
    .muted { color: var(--muted); }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
    .badge { border: 1px solid var(--line); background: var(--soft); border-radius: 999px; padding: 1px 7px; font-size: 12px; }
    .badge.good { color: var(--good); background: #eef8f1; border-color: #b7dfc6; }
    .badge.warn { color: var(--warn); background: #fff8e8; border-color: #f2d29b; }
    .badge.bad { color: var(--bad); background: #fff1ef; border-color: #f5b5ae; }
    .content { padding: 16px; min-width: 0; }
    .grid { display: grid; grid-template-columns: minmax(320px, 1.1fr) minmax(320px, 0.9fr); gap: 12px; align-items: start; }
    .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-width: 0; }
    .stack { display: grid; gap: 12px; }
    .kv { display: grid; grid-template-columns: 125px 1fr; gap: 6px; margin: 4px 0; }
    .kv span:first-child { color: var(--muted); }
    pre { margin: 0; max-height: 330px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: #fbfcfe; border: 1px solid var(--line); border-radius: 6px; padding: 10px; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    fieldset { border: 1px solid var(--line); border-radius: 6px; padding: 10px; margin: 0 0 10px; }
    legend { color: var(--muted); padding: 0 4px; }
    .choices { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    label.choice { display: flex; align-items: center; gap: 5px; background: var(--soft); border-radius: 5px; padding: 6px; }
    textarea { width: 100%; min-height: 90px; resize: vertical; border: 1px solid var(--line); border-radius: 6px; padding: 8px; }
    .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .empty { color: var(--muted); padding: 20px; }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { border-bottom: 1px solid var(--line); padding: 7px 6px; text-align: left; vertical-align: top; }
    .table th { color: var(--muted); font-size: 12px; font-weight: 650; }
    .run-button { width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 11px 12px; background: var(--surface); }
    .run-button.active { background: #e9f6f4; box-shadow: inset 3px 0 0 var(--accent); }
    .suggestions { display: grid; gap: 6px; margin-top: 8px; }
    a { color: var(--accent); }
    @media (max-width: 980px) {
      .layout, .grid { grid-template-columns: 1fr; }
      .case-list { max-height: 360px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Vendor Threat Watch Review</h1>
    <div>
      <span class="tabs" role="tablist" aria-label="Dashboard view">
        <button id="tab-human" class="tab active" type="button">Human review</button>
        <button id="tab-llm" class="tab" type="button">LLM evaluation</button>
      </span>
      <button id="refresh">Refresh</button>
    </div>
  </header>
  <div class="layout">
    <aside class="sidebar">
      <div class="filters">
        <select id="filter" aria-label="Filter cases">
          <option value="needs">Needs review</option>
          <option value="llm">LLM output</option>
          <option value="all">All cases</option>
          <option value="reviewed">Reviewed</option>
        </select>
        <select id="limit" aria-label="Case limit">
          <option value="25">25 latest</option>
          <option value="50" selected>50 latest</option>
          <option value="100">100 latest</option>
        </select>
      </div>
      <div id="summary" class="summary"></div>
      <div id="case-list" class="case-list"><p class="empty">Loading cases...</p></div>
    </aside>
    <main id="detail" class="content"><p class="empty">Select a case to review.</p></main>
  </div>
  <script>
    const state = { view: 'human', dashboard: null, llmDashboard: null, selectedId: null, selectedRunId: null };
    const verdictValues = ['not_reviewed', 'correct', 'incorrect', 'unclear'];
    const verdictLabels = {
      not_reviewed: 'Not reviewed',
      correct: 'Correct',
      incorrect: 'Incorrect',
      unclear: 'Unclear',
    };

    document.getElementById('refresh').addEventListener('click', () => state.view === 'llm' ? loadLlmEvaluations() : loadCases());
    document.getElementById('tab-human').addEventListener('click', () => switchView('human'));
    document.getElementById('tab-llm').addEventListener('click', () => switchView('llm'));
    document.getElementById('filter').addEventListener('change', render);
    document.getElementById('limit').addEventListener('change', () => state.view === 'llm' ? loadLlmEvaluations() : loadCases());
    loadCases();

    async function switchView(view) {
      state.view = view;
      document.getElementById('tab-human').classList.toggle('active', view === 'human');
      document.getElementById('tab-llm').classList.toggle('active', view === 'llm');
      document.getElementById('filter').disabled = view === 'llm';
      if (view === 'llm') {
        await loadLlmEvaluations();
      } else {
        render();
      }
    }

    async function loadCases() {
      const limit = document.getElementById('limit').value;
      const response = await fetch('/api/review-cases?limit=' + encodeURIComponent(limit));
      state.dashboard = await response.json();
      const first = filteredCases()[0];
      state.selectedId = first?.article.id ?? null;
      render();
    }

    async function loadLlmEvaluations(runId = null) {
      const limit = document.getElementById('limit').value;
      const params = new URLSearchParams({ limit });
      if (runId) params.set('runId', runId);
      const response = await fetch('/api/llm-evaluations?' + params.toString());
      state.llmDashboard = await response.json();
      state.selectedRunId = state.llmDashboard?.selectedRun?.id ?? state.llmDashboard?.runs?.[0]?.id ?? null;
      renderLlmEvaluationDashboard();
    }

    function filteredCases() {
      const cases = state.dashboard?.cases ?? [];
      const filter = document.getElementById('filter').value;
      if (filter === 'all') return cases;
      if (filter === 'llm') return cases.filter(hasLlmOutput);
      if (filter === 'reviewed') return cases.filter((item) => isReviewed(item.verdict));
      return cases.filter(needsAttention);
    }

    function render() {
      if (state.view === 'llm') {
        renderLlmEvaluationDashboard();
        return;
      }
      if (!state.dashboard) return;
      renderSummary(state.dashboard.summary);
      renderList(filteredCases());
      renderDetail(filteredCases().find((item) => item.article.id === state.selectedId) ?? filteredCases()[0] ?? null);
    }

    function renderLlmEvaluationDashboard() {
      const dashboard = state.llmDashboard;
      renderLlmSummary(dashboard);
      renderRunList(dashboard?.runs ?? []);
      renderRunDetail(dashboard?.selectedRun ?? null, dashboard);
    }

    function renderSummary(summary) {
      document.getElementById('summary').innerHTML = [
        metric('Articles', summary.totalArticles),
        metric('Needs review', summary.needsAttention),
        metric('LLM outputs', summary.llmOutputs),
        metric('Early warnings', summary.earlyWarnings),
        metric('Confirmed', summary.confirmedAlerts),
      ].join('');
    }

    function renderLlmSummary(dashboard) {
      const run = dashboard?.selectedRun;
      const metrics = run?.metrics;
      document.getElementById('summary').innerHTML = [
        metric('Runs', dashboard?.runs?.length ?? 0),
        metric('Evaluated', metrics?.totalEvaluated ?? 0),
        metric('False negatives', metrics?.falseNegativeRisks ?? 0),
        metric('False positives', metrics?.falsePositiveRisks ?? 0),
        metric('Actionable', metrics?.actionableForImpactReview ?? 0),
      ].join('');
    }

    function renderList(cases) {
      const list = document.getElementById('case-list');
      if (cases.length === 0) {
        list.innerHTML = '<p class="empty">No cases match this filter.</p>';
        return;
      }
      list.innerHTML = cases.map((item) => {
        const active = item.article.id === state.selectedId ? ' active' : '';
        return '<button class="case-button' + active + '" data-id="' + escapeAttr(item.article.id) + '">' +
          '<div class="case-title">' + escapeHtml(item.article.title || '(untitled article)') + '</div>' +
          '<div class="muted">' + escapeHtml(item.article.sourceName || 'unknown source') + ' · ' + formatDate(item.article.publishedAt) + '</div>' +
          '<div class="badges">' + caseBadges(item).join('') + '</div>' +
        '</button>';
      }).join('');
      for (const button of list.querySelectorAll('.case-button')) {
        button.addEventListener('click', () => {
          state.selectedId = button.dataset.id;
          render();
        });
      }
    }

    function renderRunList(runs) {
      const list = document.getElementById('case-list');
      if (!state.llmDashboard?.available) {
        list.innerHTML = '<p class="empty">' + escapeHtml(state.llmDashboard?.message || 'LLM evaluation is unavailable.') + '</p>';
        return;
      }
      if (runs.length === 0) {
        list.innerHTML = '<p class="empty">' + escapeHtml(state.llmDashboard?.message || 'No LLM evaluation runs found.') + '</p>';
        return;
      }
      list.innerHTML = runs.map((run) => {
        const active = run.id === state.selectedRunId ? ' active' : '';
        return '<button class="run-button' + active + '" data-id="' + escapeAttr(run.id) + '">' +
          '<div class="case-title">' + escapeHtml(run.modelName) + '</div>' +
          '<div class="muted">' + escapeHtml(formatDate(run.startedAt)) + '</div>' +
          '<div class="badges">' +
            badge(String(run.totalEvaluationsSaved) + ' judged', run.totalEvaluationsFailed > 0 ? 'warn' : 'good') +
            (run.totalEvaluationsFailed > 0 ? badge(String(run.totalEvaluationsFailed) + ' failed', 'bad') : '') +
          '</div>' +
        '</button>';
      }).join('');
      for (const button of list.querySelectorAll('.run-button')) {
        button.addEventListener('click', async () => {
          state.selectedRunId = button.dataset.id;
          await loadLlmEvaluations(state.selectedRunId);
        });
      }
    }

    function renderDetail(item) {
      const detail = document.getElementById('detail');
      if (!item) {
        detail.innerHTML = '<p class="empty">No case selected.</p>';
        return;
      }
      const event = item.events[0] ?? null;
      detail.innerHTML = '<div class="grid">' +
        '<section class="stack">' +
          panel('Article', articleHtml(item)) +
          panel('RSS Summary', '<pre>' + escapeHtml(item.article.rssSummary || '(empty)') + '</pre>') +
          panel('Extracted Text', '<pre>' + escapeHtml(item.article.cleanText || '(empty)') + '</pre>') +
        '</section>' +
        '<aside class="stack">' +
          panel('Pipeline Output', pipelineHtml(item)) +
          panel('Human Verdict', reviewFormHtml(item, event)) +
        '</aside>' +
      '</div>';
      document.getElementById('review-form').addEventListener('submit', (eventSubmit) => submitReview(eventSubmit, item, event));
    }

    function renderRunDetail(run, dashboard) {
      const detail = document.getElementById('detail');
      if (!dashboard?.available) {
        detail.innerHTML = '<p class="empty">' + escapeHtml(dashboard?.message || 'LLM evaluation is unavailable.') + '</p>';
        return;
      }
      if (!run) {
        detail.innerHTML = '<p class="empty">' + escapeHtml(dashboard?.message || 'Run the LLM judge, then refresh this tab.') + '</p>';
        return;
      }
      detail.innerHTML = '<div class="grid">' +
        '<section class="stack">' +
          panel('Run Summary', llmRunSummaryHtml(run)) +
          panel('Priority Findings', llmPriorityHtml(run)) +
        '</section>' +
        '<aside class="stack">' +
          panel('Scoring Issues', countTable(run.issueCounts, 'Issue')) +
          panel('Relevance Types', countTable(run.relevanceCounts, 'Type')) +
        '</aside>' +
      '</div>';
    }

    async function submitReview(eventSubmit, item, event) {
      eventSubmit.preventDefault();
      const form = new FormData(eventSubmit.currentTarget);
      const payload = {
        articleId: item.article.id,
        eventId: event?.eventId ?? null,
        relevanceVerdict: form.get('relevanceVerdict'),
        vendorImpactVerdict: form.get('vendorImpactVerdict'),
        groupingVerdict: form.get('groupingVerdict'),
        alertVerdict: form.get('alertVerdict'),
        llmClassificationVerdict: form.get('llmClassificationVerdict'),
        notes: form.get('notes') || null,
        reviewer: form.get('reviewer') || null,
      };
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json();
        document.getElementById('form-status').textContent = error.error?.message || 'Failed to save review.';
        return;
      }
      document.getElementById('form-status').textContent = 'Saved.';
      await loadCases();
    }

    function articleHtml(item) {
      const article = item.article;
      return kvText('Article ID', article.id) +
        kvText('Published', formatDate(article.publishedAt)) +
        kvText('Fetched', formatDate(article.fetchedAt)) +
        kvText('Status', article.processingStatus) +
        kvText('Extraction', (article.extractionMethod || 'unknown') + ' / ' + article.extractionStatus) +
        kvText('Quality', article.contentQualityScore == null ? 'n/a' : Number(article.contentQualityScore).toFixed(2)) +
        kvText('RSS recall', article.rssRecall == null ? 'n/a' : Math.round(article.rssRecall * 100) + '%') +
        (article.canonicalUrl ? kvHtml('Source', '<a href="' + escapeAttr(article.canonicalUrl) + '" target="_blank" rel="noreferrer">open source</a>') : '');
    }

    function pipelineHtml(item) {
      const entities = item.entities.length
        ? '<ul>' + item.entities.map((entity) => '<li>' + escapeHtml(entity.entityType) + ': <strong>' + escapeHtml(entity.entityValue) + '</strong>' + (entity.role ? ' (' + escapeHtml(entity.role) + ')' : '') + '</li>').join('') + '</ul>'
        : '<p class="muted">No entities detected.</p>';
      const events = item.events.length
        ? item.events.map((event) => '<div>' +
            '<strong>' + escapeHtml(event.eventTitle || '(untitled event)') + '</strong>' +
            kvText('Event ID', event.eventId) +
            kvText('Grouping', event.groupingKey || 'none') +
            kvText('Relationship', event.relationship || 'unknown') +
            kvText('Severity', event.severity || 'n/a') +
            kvText('Urgency', event.urgency || 'n/a') +
            kvText('Confidence', event.eventConfidence == null ? 'n/a' : Math.round(event.eventConfidence * 100) + '%') +
            kvText('Affected', [...event.affectedVendors, ...event.affectedProducts].join(', ') || 'none') +
            kvText('CVEs', event.cves.join(', ') || 'none') +
          '</div>').join('')
        : '<p class="muted">No linked event.</p>';
      const alerts = item.alerts.length
        ? '<ul>' + item.alerts.map((alert) => '<li>' + escapeHtml(alert.alertTier || 'untiered') + ' · ' + escapeHtml(alert.suppressed ? 'suppressed: ' + (alert.suppressionReason || 'unspecified') : (alert.alertReason || 'sent')) + '</li>').join('') + '</ul>'
        : '<p class="muted">No alert decision yet.</p>';
      const audits = item.audits.length
        ? '<ul>' + item.audits.map((audit) => '<li>' + escapeHtml(audit.taskName) + ' · ' + escapeHtml(audit.validationStatus) + '</li>').join('') + '</ul>'
        : '<p class="muted">No LLM calls recorded.</p>';
      const llmClassification = hasLlmOutput(item)
        ? '<pre>' + escapeHtml(JSON.stringify(item.article.llmClassification, null, 2)) + '</pre>'
        : '<p class="muted">No LLM classification recorded. This case is currently ' + escapeHtml(item.article.processingStatus) + ', so it may not have reached the classification stage.</p>';
      return '<h3>Entities</h3>' + entities + '<h3>LLM Classification</h3>' + llmClassification + '<h3>Events</h3>' + events + '<h3>Alerts</h3>' + alerts + '<h3>LLM Audit</h3>' + audits;
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
        '<div class="summary">' +
          metric('Critical', metrics.criticalRelevant) +
          metric('Relevant', metrics.relevant) +
          metric('Borderline', metrics.borderline) +
          metric('Irrelevant', metrics.irrelevant) +
        '</div>' +
        '<h3>Quality signals</h3>' +
        '<div class="summary">' +
          metric('False negatives', metrics.falseNegativeRisks) +
          metric('False positives', metrics.falsePositiveRisks) +
          metric('Over-scored irrelevant', metrics.overScoredIrrelevant) +
          metric('Under-scored critical', metrics.underScoredCritical) +
        '</div>';
    }

    function llmPriorityHtml(run) {
      const rows = run.evaluations || [];
      if (rows.length === 0) return '<p class="muted">No saved evaluations in this run.</p>';
      return '<table class="table"><thead><tr><th>Article</th><th>Cheap filter</th><th>LLM judge</th><th>Why it matters</th></tr></thead><tbody>' +
        rows.slice(0, 40).map((item) => '<tr>' +
          '<td>' +
            (item.articleUrl ? '<a href="' + escapeAttr(item.articleUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(item.articleTitle || 'Article ' + item.articleId) + '</a>' : escapeHtml(item.articleTitle || 'Article ' + item.articleId)) +
            '<div class="muted">' + escapeHtml(item.sourceName || 'unknown source') + ' · ' + formatDate(item.publishedAt) + '</div>' +
          '</td>' +
          '<td>' + badge(item.cheapFilterDecision, item.cheapFilterDecision === 'DROP' ? 'bad' : item.cheapFilterDecision === 'MAYBE_KEEP' ? 'warn' : 'good') + '<div class="muted">score ' + escapeHtml(String(item.cheapFilterScore)) + '</div></td>' +
          '<td>' + badge(item.llmLabel, item.llmLabel === 'IRRELEVANT' ? 'bad' : item.llmLabel === 'BORDERLINE' ? 'warn' : 'good') + '<div class="muted">' + escapeHtml(item.scoreAssessment) + (item.recommendedScoreBand ? ' · ' + escapeHtml(item.recommendedScoreBand) : '') + '</div></td>' +
          '<td>' +
            '<div>' + escapeHtml(item.scoringIssue) + '</div>' +
            '<div class="muted">' + escapeHtml(item.explanation) + '</div>' +
            suggestionsHtml(item) +
          '</td>' +
        '</tr>').join('') +
      '</tbody></table>';
    }

    function suggestionsHtml(item) {
      const suggestions = [
        ...item.suggestedRuleChanges.map((value) => 'Rule: ' + value),
        ...item.suggestedKeywordsToAdd.map((value) => 'Keyword: ' + value),
        ...item.suggestedVendorProductAliasesToAdd.map((value) => 'Alias: ' + value),
      ];
      if (suggestions.length === 0) return '';
      return '<div class="suggestions">' + suggestions.slice(0, 4).map((value) => badge(value, 'warn')).join('') + '</div>';
    }

    function countTable(rows, label) {
      if (!rows || rows.length === 0) return '<p class="muted">No data.</p>';
      return '<table class="table"><thead><tr><th>' + escapeHtml(label) + '</th><th>Count</th></tr></thead><tbody>' +
        rows.map((row) => '<tr><td>' + escapeHtml(row.key) + '</td><td>' + escapeHtml(String(row.count)) + '</td></tr>').join('') +
      '</tbody></table>';
    }

    function reviewFormHtml(item, event) {
      const verdict = item.verdict || {};
      return '<form id="review-form">' +
        verdictField('relevanceVerdict', 'Is the cyber relevance correct?', verdict.relevanceVerdict || 'not_reviewed') +
        verdictField('vendorImpactVerdict', 'Is the vendor/product impact correct?', verdict.vendorImpactVerdict || 'not_reviewed') +
        verdictField('llmClassificationVerdict', 'Is the LLM classification output correct?', verdict.llmClassificationVerdict || 'not_reviewed') +
        verdictField('groupingVerdict', 'Is the event grouping correct?', verdict.groupingVerdict || 'not_reviewed') +
        verdictField('alertVerdict', 'Is the alert decision correct?', verdict.alertVerdict || 'not_reviewed') +
        '<label class="muted" for="reviewer">Reviewer</label><input id="reviewer" name="reviewer" value="' + escapeAttr(verdict.reviewer || '') + '" placeholder="optional">' +
        '<label class="muted" for="notes">Notes</label><textarea id="notes" name="notes" placeholder="Why is this correct, wrong, or unclear?">' + escapeHtml(verdict.notes || '') + '</textarea>' +
        '<div class="actions"><button class="primary" type="submit">Save verdict</button><span id="form-status" class="muted">' + (verdict.reviewedAt ? 'Last saved ' + formatDate(verdict.reviewedAt) : '') + '</span></div>' +
      '</form>';
    }

    function verdictField(name, legend, selected) {
      return '<fieldset><legend>' + escapeHtml(legend) + '</legend><div class="choices">' +
        verdictValues.map((value) => '<label class="choice"><input type="radio" name="' + escapeAttr(name) + '" value="' + value + '"' + (value === selected ? ' checked' : '') + '> ' + verdictLabels[value] + '</label>').join('') +
      '</div></fieldset>';
    }

    function needsAttention(item) {
      if (isReviewed(item.verdict)) return false;
      return item.article.extractionStatus === 'failed' ||
        (item.article.rssRecall != null && item.article.rssRecall < 0.6) ||
        (item.article.contentQualityScore != null && item.article.contentQualityScore < 0.3) ||
        item.events.some((event) => event.relationship === 'uncertain_need_human_review' || (event.eventConfidence != null && event.eventConfidence < 0.65)) ||
        item.alerts.some((alert) => alert.alertTier === 'early_warning' && !alert.suppressed);
    }

    function isReviewed(verdict) {
      return Boolean(verdict && ['relevanceVerdict', 'vendorImpactVerdict', 'llmClassificationVerdict', 'groupingVerdict', 'alertVerdict'].some((key) => verdict[key] && verdict[key] !== 'not_reviewed'));
    }

    function hasLlmOutput(item) {
      return item.article.llmClassification !== null && item.article.llmClassification !== undefined;
    }

    function caseBadges(item) {
      const badges = [badge(isReviewed(item.verdict) ? 'reviewed' : needsAttention(item) ? 'review' : 'ok', isReviewed(item.verdict) ? 'good' : needsAttention(item) ? 'warn' : 'good')];
      badges.push(badge(item.article.processingStatus));
      if (item.article.extractionStatus === 'failed') badges.push(badge('extraction failed', 'bad'));
      for (const event of item.events) {
        if (event.severity) badges.push(badge(event.severity, event.severity === 'critical' || event.severity === 'high' ? 'bad' : event.severity === 'medium' ? 'warn' : ''));
        if (event.urgency) badges.push(badge(event.urgency, event.urgency === 'P1' || event.urgency === 'P2' ? 'warn' : ''));
      }
      for (const alert of item.alerts) {
        if (!alert.suppressed && alert.alertTier) badges.push(badge(alert.alertTier, alert.alertTier === 'early_warning' ? 'warn' : 'good'));
      }
      return badges;
    }

    function metric(label, value) {
      return '<div class="metric"><strong>' + escapeHtml(String(value)) + '</strong><span>' + escapeHtml(label) + '</span></div>';
    }
    function panel(title, body) { return '<section class="panel"><h2>' + escapeHtml(title) + '</h2>' + body + '</section>'; }
    function kvText(label, value) { return '<div class="kv"><span>' + escapeHtml(label) + '</span><span>' + escapeHtml(value) + '</span></div>'; }
    function kvHtml(label, valueHtml) { return '<div class="kv"><span>' + escapeHtml(label) + '</span><span>' + valueHtml + '</span></div>'; }
    function badge(text, tone = '') { return '<span class="badge ' + escapeAttr(tone) + '">' + escapeHtml(text) + '</span>'; }
    function formatDate(value) { return value ? String(value).replace('T', ' ').replace(/\\.\\d{3}Z$/, ' UTC') : 'unknown'; }
    function escapeHtml(value) {
      return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    }
    function escapeAttr(value) { return escapeHtml(value).replaceAll('\\x60', '&#96;'); }
  </script>
</body>
</html>`;
}
