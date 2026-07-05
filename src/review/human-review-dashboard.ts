import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Queryable } from '../db/repositories/types.js';

export const ReviewVerdictSchema = z.enum(['not_reviewed', 'correct', 'incorrect', 'unclear']);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const HumanReviewSubmissionSchema = z.object({
  articleId: z.string().regex(/^\d+$/),
  eventId: z.string().regex(/^\d+$/).nullable().optional(),
  relevanceVerdict: ReviewVerdictSchema,
  vendorImpactVerdict: ReviewVerdictSchema,
  llmClassificationVerdict: ReviewVerdictSchema.default('not_reviewed'),
  groupingVerdict: ReviewVerdictSchema,
  alertVerdict: ReviewVerdictSchema,
  notes: z.string().max(4000).nullable().optional(),
  reviewer: z.string().max(120).nullable().optional(),
});

export type HumanReviewSubmission = z.infer<typeof HumanReviewSubmissionSchema>;

export interface HumanReviewArticle {
  id: string;
  title: string | null;
  canonicalUrl: string | null;
  sourceName: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
  processingStatus: string;
  extractionStatus: string;
  extractionMethod: string | null;
  extractionError: string | null;
  contentQualityScore: number | null;
  rssRecall: number | null;
  rssSummary: string | null;
  cleanText: string | null;
  llmClassification: unknown;
}

export interface HumanReviewEntity {
  articleId: string;
  entityType: string;
  entityValue: string;
  confidence: number | null;
  role: string | null;
}

export interface HumanReviewEvent {
  articleId: string;
  eventId: string;
  eventTitle: string | null;
  eventSummary: string | null;
  groupingKey: string | null;
  relationship: string | null;
  relationshipConfidence: number | null;
  isPrimarySource: boolean;
  isMaterialUpdate: boolean;
  severity: string | null;
  urgency: string | null;
  eventConfidence: number | null;
  affectedVendors: string[];
  affectedProducts: string[];
  cves: string[];
  attackTypes: string[];
}

export interface HumanReviewAlert {
  eventId: string;
  alertStatus: string | null;
  alertTier: string | null;
  alertReason: string | null;
  suppressed: boolean;
  suppressionReason: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface HumanReviewAudit {
  targetType: string;
  targetId: string;
  taskName: string;
  validationStatus: string;
  createdAt: Date;
}

export interface HumanReviewVerdictRecord {
  articleId: string;
  eventId: string | null;
  relevanceVerdict: ReviewVerdict;
  vendorImpactVerdict: ReviewVerdict;
  llmClassificationVerdict: ReviewVerdict;
  groupingVerdict: ReviewVerdict;
  alertVerdict: ReviewVerdict;
  notes: string | null;
  reviewer: string | null;
  reviewedAt: Date;
}

export interface HumanReviewCase {
  article: HumanReviewArticle;
  entities: HumanReviewEntity[];
  events: HumanReviewEvent[];
  alerts: HumanReviewAlert[];
  audits: HumanReviewAudit[];
  verdict: HumanReviewVerdictRecord | null;
}

export interface HumanReviewDashboard {
  generatedAt: Date;
  cases: HumanReviewCase[];
  summary: HumanReviewSummary;
}

export interface HumanReviewSummary {
  totalArticles: number;
  needsAttention: number;
  earlyWarnings: number;
  confirmedAlerts: number;
  suppressedAlerts: number;
  llmOutputs: number;
  extractionFailures: number;
  lowExtractionQuality: number;
  materialUpdates: number;
}

interface DashboardOptions {
  limit?: number;
  outputDir?: string;
}

interface ArticleRow {
  id: string;
  title: string | null;
  canonical_url: string | null;
  source_name: string | null;
  published_at: Date | null;
  fetched_at: Date;
  processing_status: string;
  extraction_status: string;
  extraction_method: string | null;
  extraction_error: string | null;
  content_quality_score: string | null;
  rss_recall: string | null;
  rss_summary: string | null;
  clean_text: string | null;
  llm_classification: unknown;
}

interface EntityRow {
  article_id: string;
  entity_type: string;
  entity_value: string;
  confidence: string | null;
  role: string | null;
}

interface EventRow {
  article_id: string;
  event_id: string;
  event_title: string | null;
  event_summary: string | null;
  grouping_key: string | null;
  relationship: string | null;
  relationship_confidence: string | null;
  is_primary_source: boolean;
  is_material_update: boolean;
  severity: string | null;
  urgency: string | null;
  event_confidence: string | null;
  affected_vendors: string[];
  affected_products: string[];
  cves: string[];
  attack_types: string[];
}

interface AlertRow {
  event_id: string;
  alert_status: string | null;
  alert_tier: string | null;
  alert_reason: string | null;
  suppressed: boolean;
  suppression_reason: string | null;
  sent_at: Date | null;
  created_at: Date;
}

interface AuditRow {
  target_type: string;
  target_id: string;
  task_name: string;
  validation_status: string;
  created_at: Date;
}

interface VerdictRow {
  article_id: string;
  event_id: string | null;
  relevance_verdict: ReviewVerdict;
  vendor_impact_verdict: ReviewVerdict;
  llm_classification_verdict: ReviewVerdict;
  grouping_verdict: ReviewVerdict;
  alert_verdict: ReviewVerdict;
  notes: string | null;
  reviewer: string | null;
  reviewed_at: Date;
}

export async function writeHumanReviewDashboard(
  db: Queryable,
  options: DashboardOptions = {}
): Promise<{ dashboard: HumanReviewDashboard; outputPath: string }> {
  const dashboard = await loadHumanReviewDashboard(db, options.limit);
  const outputDir = options.outputDir ?? join(process.cwd(), 'review', 'human-dashboard');
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'index.html');
  await writeFile(outputPath, renderHumanReviewDashboard(dashboard), 'utf8');
  return { dashboard, outputPath };
}

export async function loadHumanReviewDashboard(db: Queryable, limit = 50): Promise<HumanReviewDashboard> {
  const articleResult = await db.query<ArticleRow>(
    `
      SELECT id, title, canonical_url, source_name, published_at, fetched_at, processing_status,
        extraction_status, extraction_method, extraction_error, content_quality_score, rss_recall,
        rss_summary, clean_text, llm_classification
      FROM articles
      ORDER BY fetched_at DESC, id DESC
      LIMIT $1
    `,
    [limit]
  );

  const articles = articleResult.rows.map(mapArticle);
  const articleIds = articles.map((article) => article.id);
  if (articleIds.length === 0) {
    const dashboard = { generatedAt: new Date(), cases: [], summary: summarizeCases([]) };
    return dashboard;
  }

  const [entityResult, eventResult, auditResult, verdictResult] = await Promise.all([
    db.query<EntityRow>(
      `
        SELECT article_id, entity_type, entity_value, confidence, role
        FROM article_entities
        WHERE article_id = ANY($1::BIGINT[])
        ORDER BY entity_type ASC, entity_value ASC
      `,
      [articleIds]
    ),
    db.query<EventRow>(
      `
        SELECT ea.article_id, e.id AS event_id, e.event_title, e.event_summary, e.grouping_key,
          ea.relationship, ea.confidence AS relationship_confidence, ea.is_primary_source,
          ea.is_material_update, e.severity, e.urgency, e.confidence AS event_confidence,
          e.affected_vendors, e.affected_products, e.cves, e.attack_types
        FROM event_articles ea
        JOIN cyber_events e ON e.id = ea.event_id
        WHERE ea.article_id = ANY($1::BIGINT[])
        ORDER BY ea.created_at DESC
      `,
      [articleIds]
    ),
    db.query<AuditRow>(
      `
        SELECT target_type, target_id, task_name, validation_status, created_at
        FROM llm_audit_logs
        WHERE (target_type = 'article' AND target_id = ANY($1::BIGINT[]))
           OR (
             target_type = 'event'
             AND target_id IN (
               SELECT event_id FROM event_articles WHERE article_id = ANY($1::BIGINT[])
             )
           )
        ORDER BY created_at DESC
      `,
      [articleIds]
    ),
    db.query<VerdictRow>(
      `
        SELECT article_id, event_id, relevance_verdict, vendor_impact_verdict,
          llm_classification_verdict,
          grouping_verdict, alert_verdict, notes, reviewer, reviewed_at
        FROM human_review_verdicts
        WHERE article_id = ANY($1::BIGINT[])
      `,
      [articleIds]
    ),
  ]);

  const events = eventResult.rows.map(mapEvent);
  const eventIds = Array.from(new Set(events.map((event) => event.eventId)));
  const alertRows =
    eventIds.length === 0
      ? []
      : (
          await db.query<AlertRow>(
            `
              SELECT event_id, alert_status, alert_tier, alert_reason, suppressed, suppression_reason,
                sent_at, created_at
              FROM alerts
              WHERE event_id = ANY($1::BIGINT[])
              ORDER BY created_at DESC
            `,
            [eventIds]
          )
        ).rows;

  const entitiesByArticle = groupBy(entityResult.rows.map(mapEntity), (entity) => entity.articleId);
  const eventsByArticle = groupBy(events, (event) => event.articleId);
  const alertsByEvent = groupBy(alertRows.map(mapAlert), (alert) => alert.eventId);
  const auditsByTarget = groupBy(auditResult.rows.map(mapAudit), (audit) => `${audit.targetType}:${audit.targetId}`);
  const verdictByArticle = new Map(verdictResult.rows.map((row) => [row.article_id, mapVerdict(row)]));

  const cases = articles.map((article) => {
    const caseEvents = eventsByArticle.get(article.id) ?? [];
    const alerts = caseEvents.flatMap((event) => alertsByEvent.get(event.eventId) ?? []);
    const audits = [
      ...(auditsByTarget.get(`article:${article.id}`) ?? []),
      ...caseEvents.flatMap((event) => auditsByTarget.get(`event:${event.eventId}`) ?? []),
    ];

    return {
      article,
      entities: entitiesByArticle.get(article.id) ?? [],
      events: caseEvents,
      alerts,
      audits,
      verdict: verdictByArticle.get(article.id) ?? null,
    };
  });

  return {
    generatedAt: new Date(),
    cases,
    summary: summarizeCases(cases),
  };
}

export function summarizeCases(cases: HumanReviewCase[]): HumanReviewSummary {
  return {
    totalArticles: cases.length,
    needsAttention: cases.filter(needsHumanAttention).length,
    earlyWarnings: countAlerts(cases, (alert) => !alert.suppressed && alert.alertTier === 'early_warning'),
    confirmedAlerts: countAlerts(cases, (alert) => !alert.suppressed && alert.alertTier === 'confirmed'),
    suppressedAlerts: countAlerts(cases, (alert) => alert.suppressed),
    llmOutputs: cases.filter((item) => hasLlmOutput(item)).length,
    extractionFailures: cases.filter((item) => item.article.extractionStatus === 'failed').length,
    lowExtractionQuality: cases.filter(isLowExtractionQuality).length,
    materialUpdates: cases.filter((item) => item.events.some((event) => event.isMaterialUpdate)).length,
  };
}

export function needsHumanAttention(reviewCase: HumanReviewCase): boolean {
  if (reviewCase.verdict && isReviewed(reviewCase.verdict)) return false;

  return (
    reviewCase.article.extractionStatus === 'failed' ||
    isLowExtractionQuality(reviewCase) ||
    reviewCase.events.some((event) => event.relationship === 'uncertain_need_human_review') ||
    reviewCase.events.some((event) => event.eventConfidence !== null && event.eventConfidence < 0.65) ||
    reviewCase.alerts.some((alert) => alert.alertTier === 'early_warning' && !alert.suppressed)
  );
}

export async function saveHumanReviewVerdict(
  db: Queryable,
  input: HumanReviewSubmission
): Promise<HumanReviewVerdictRecord> {
  const review = HumanReviewSubmissionSchema.parse(input);
  if (review.eventId) {
    const linkResult = await db.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM event_articles
          WHERE article_id = $1
            AND event_id = $2
        ) AS exists
      `,
      [review.articleId, review.eventId]
    );

    if (!linkResult.rows[0]?.exists) {
      throw new HumanReviewValidationError('Selected event is not linked to this article.');
    }
  }

  const result = await db.query<VerdictRow>(
    `
      INSERT INTO human_review_verdicts (
        article_id,
        event_id,
        relevance_verdict,
        vendor_impact_verdict,
        llm_classification_verdict,
        grouping_verdict,
        alert_verdict,
        notes,
        reviewer,
        reviewed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      ON CONFLICT (article_id)
      DO UPDATE SET
        event_id = EXCLUDED.event_id,
        relevance_verdict = EXCLUDED.relevance_verdict,
        vendor_impact_verdict = EXCLUDED.vendor_impact_verdict,
        llm_classification_verdict = EXCLUDED.llm_classification_verdict,
        grouping_verdict = EXCLUDED.grouping_verdict,
        alert_verdict = EXCLUDED.alert_verdict,
        notes = EXCLUDED.notes,
        reviewer = EXCLUDED.reviewer,
        reviewed_at = now(),
        updated_at = now()
      RETURNING article_id, event_id, relevance_verdict, vendor_impact_verdict,
        llm_classification_verdict,
        grouping_verdict, alert_verdict, notes, reviewer, reviewed_at
    `,
    [
      review.articleId,
      review.eventId ?? null,
      review.relevanceVerdict,
      review.vendorImpactVerdict,
      review.llmClassificationVerdict,
      review.groupingVerdict,
      review.alertVerdict,
      normalizeOptionalText(review.notes),
      normalizeOptionalText(review.reviewer),
    ]
  );

  return mapVerdict(result.rows[0]);
}

export class HumanReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HumanReviewValidationError';
  }
}

export function isReviewed(verdict: HumanReviewVerdictRecord): boolean {
  return (
    verdict.relevanceVerdict !== 'not_reviewed' ||
    verdict.vendorImpactVerdict !== 'not_reviewed' ||
    verdict.llmClassificationVerdict !== 'not_reviewed' ||
    verdict.groupingVerdict !== 'not_reviewed' ||
    verdict.alertVerdict !== 'not_reviewed'
  );
}

export function renderHumanReviewDashboard(dashboard: HumanReviewDashboard): string {
  const rows = dashboard.cases.map(renderCase).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Human Review Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --surface: #ffffff;
      --surface-soft: #f1f4f8;
      --line: #d8dee8;
      --text: #17202a;
      --muted: #5f6b7a;
      --accent: #0f766e;
      --warn: #a15c00;
      --bad: #b42318;
      --good: #146c43;
      --shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--line);
      padding: 20px 24px 16px;
    }
    h1 { margin: 0 0 4px; font-size: 24px; font-weight: 680; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 16px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: var(--muted); letter-spacing: 0; }
    .subtle { color: var(--muted); }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px;
      padding: 16px 24px;
    }
    .metric {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 12px;
      box-shadow: var(--shadow);
    }
    .metric strong { display: block; font-size: 22px; line-height: 1.15; }
    main { padding: 0 24px 24px; }
    details {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      margin: 10px 0;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    details[open] summary { border-bottom: 1px solid var(--line); }
    summary {
      cursor: pointer;
      display: grid;
      grid-template-columns: minmax(220px, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
    }
    .title { font-weight: 650; overflow-wrap: anywhere; }
    .meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .badge {
      border: 1px solid var(--line);
      background: var(--surface-soft);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      white-space: nowrap;
    }
    .badge.good { color: var(--good); border-color: #b7dfc6; background: #eef8f1; }
    .badge.warn { color: var(--warn); border-color: #f2d29b; background: #fff8e8; }
    .badge.bad { color: var(--bad); border-color: #f5b5ae; background: #fff1ef; }
    .body {
      display: grid;
      grid-template-columns: minmax(280px, 1.15fr) minmax(280px, 0.85fr);
      gap: 14px;
      padding: 14px;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px;
      min-width: 0;
    }
    .stack { display: grid; gap: 10px; }
    .kv { display: grid; grid-template-columns: 120px 1fr; gap: 6px; margin: 4px 0; }
    .kv span:first-child { color: var(--muted); }
    pre {
      margin: 0;
      max-height: 340px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #fbfcfe;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    ul { margin: 0; padding-left: 18px; }
    a { color: var(--accent); }
    .review-box {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 10px;
    }
    .review-box label {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
      background: var(--surface-soft);
    }
    .empty { color: var(--muted); font-style: italic; }
    @media (max-width: 900px) {
      summary, .body { grid-template-columns: 1fr; }
      .badges { justify-content: flex-start; }
      .review-box { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Human Review Dashboard</h1>
    <div class="subtle">Generated ${escapeHtml(formatDate(dashboard.generatedAt))}. Review pipeline output case by case, then promote confirmed judgements into the labelled evaluation set.</div>
  </header>
  ${renderSummary(dashboard.summary)}
  <main>
    ${rows || '<p class="empty">No articles found. Run ingestion and pipeline stages, then regenerate this dashboard.</p>'}
  </main>
</body>
</html>`;
}

function renderSummary(summary: HumanReviewSummary): string {
  const metrics: Array<[string, number]> = [
    ['Articles', summary.totalArticles],
    ['Needs review', summary.needsAttention],
    ['Early warnings', summary.earlyWarnings],
    ['Confirmed', summary.confirmedAlerts],
    ['Suppressed', summary.suppressedAlerts],
    ['LLM outputs', summary.llmOutputs],
    ['Extraction failures', summary.extractionFailures],
    ['Low quality', summary.lowExtractionQuality],
    ['Material updates', summary.materialUpdates],
  ];

  return `<section class="summary">${metrics
    .map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`)
    .join('')}</section>`;
}

function renderCase(reviewCase: HumanReviewCase, index: number): string {
  const { article } = reviewCase;
  const attention = needsHumanAttention(reviewCase);
  const title = article.title ?? '(untitled article)';
  const eventBadges = reviewCase.events.flatMap((event) => [
    event.severity ? badge(event.severity, severityTone(event.severity)) : '',
    event.urgency ? badge(event.urgency, event.urgency === 'P1' || event.urgency === 'P2' ? 'warn' : '') : '',
    event.eventConfidence !== null ? badge(`conf ${formatPercent(event.eventConfidence)}`, confidenceTone(event.eventConfidence)) : '',
    event.isMaterialUpdate ? badge('material update', 'warn') : '',
  ]);
  const alertBadges = reviewCase.alerts.map((alert) =>
    badge(alert.suppressed ? `suppressed: ${alert.suppressionReason ?? 'unspecified'}` : alert.alertTier ?? 'alert', alert.suppressed ? '' : 'warn')
  );

  return `<details ${index === 0 || attention ? 'open' : ''}>
    <summary>
      <div>
        <div class="title">${escapeHtml(title)}</div>
        <div class="meta">${escapeHtml(article.sourceName ?? 'unknown source')} · ${escapeHtml(formatDate(article.publishedAt))} · <a href="${escapeAttribute(article.canonicalUrl ?? '#')}" target="_blank" rel="noreferrer">source</a></div>
      </div>
      <div class="badges">
        ${badge(attention ? 'review' : 'ok', attention ? 'warn' : 'good')}
        ${badge(article.processingStatus)}
        ${badge(article.extractionStatus, article.extractionStatus === 'failed' ? 'bad' : '')}
        ${article.rssRecall !== null ? badge(`rss ${formatPercent(article.rssRecall)}`, article.rssRecall < 0.6 ? 'bad' : '') : ''}
        ${eventBadges.join('')}
        ${alertBadges.join('')}
      </div>
    </summary>
    <div class="body">
      <section class="panel stack">
        <div>
          <h2>Article</h2>
          ${kv('ID', article.id)}
          ${kv('Fetched', formatDate(article.fetchedAt))}
          ${kv('Extraction', `${article.extractionMethod ?? 'unknown'} / ${article.extractionStatus}`)}
          ${kv('Quality', article.contentQualityScore === null ? 'n/a' : article.contentQualityScore.toFixed(2))}
          ${article.extractionError ? kv('Error', article.extractionError) : ''}
        </div>
        <div>
          <h3>RSS Summary</h3>
          <pre>${escapeHtml(article.rssSummary ?? '(empty)')}</pre>
        </div>
        <div>
          <h3>Extracted Text</h3>
          <pre>${escapeHtml(article.cleanText ?? '(empty)')}</pre>
        </div>
      </section>
      <aside class="stack">
        <section class="panel">
          <h2>Pipeline Output</h2>
          ${renderEntities(reviewCase.entities)}
          ${renderLlmClassification(reviewCase.article.llmClassification)}
          ${renderEvents(reviewCase.events)}
          ${renderAlerts(reviewCase.alerts)}
          ${renderAudits(reviewCase.audits)}
        </section>
        <section class="panel">
          <h2>Human Verdict</h2>
          ${reviewCase.verdict ? `<p><strong>Reviewed:</strong> ${escapeHtml(formatDate(reviewCase.verdict.reviewedAt))}</p>` : ''}
          <div class="review-box">
            <label><input type="checkbox"> Relevant cyber event</label>
            <label><input type="checkbox"> Vendor impact correct</label>
            <label><input type="checkbox"> Alert decision correct</label>
          </div>
          <p class="subtle">This first dashboard is read-only. Use these prompts while reviewing; the next slice can persist verdicts into a review queue and export labels.</p>
        </section>
      </aside>
    </div>
  </details>`;
}

function renderEntities(entities: HumanReviewEntity[]): string {
  if (entities.length === 0) return '<h3>Entities</h3><p class="empty">No entities detected.</p>';
  return `<h3>Entities</h3><ul>${entities
    .map((entity) => `<li>${escapeHtml(entity.entityType)}: <strong>${escapeHtml(entity.entityValue)}</strong>${entity.role ? ` (${escapeHtml(entity.role)})` : ''}</li>`)
    .join('')}</ul>`;
}

function renderLlmClassification(classification: unknown): string {
  if (classification === null || classification === undefined) {
    return '<h3>LLM Classification</h3><p class="empty">No LLM classification recorded. This case may not have reached the classification stage.</p>';
  }

  return `<h3>LLM Classification</h3><pre>${escapeHtml(JSON.stringify(classification, null, 2))}</pre>`;
}

function renderEvents(events: HumanReviewEvent[]): string {
  if (events.length === 0) return '<h3>Events</h3><p class="empty">No linked event.</p>';
  return `<h3>Events</h3>${events
    .map(
      (event) => `<div>
        <strong>${escapeHtml(event.eventTitle ?? '(untitled event)')}</strong>
        ${kv('Event ID', event.eventId)}
        ${kv('Grouping', event.groupingKey ?? 'none')}
        ${kv('Relationship', `${event.relationship ?? 'unknown'}${event.relationshipConfidence !== null ? ` (${formatPercent(event.relationshipConfidence)})` : ''}`)}
        ${kv('Affected', [...event.affectedVendors, ...event.affectedProducts].join(', ') || 'none')}
        ${kv('CVEs', event.cves.join(', ') || 'none')}
        ${event.eventSummary ? `<pre>${escapeHtml(event.eventSummary)}</pre>` : ''}
      </div>`
    )
    .join('')}`;
}

function renderAlerts(alerts: HumanReviewAlert[]): string {
  if (alerts.length === 0) return '<h3>Alerts</h3><p class="empty">No alert decision yet.</p>';
  return `<h3>Alerts</h3><ul>${alerts
    .map((alert) => `<li>${escapeHtml(alert.alertTier ?? 'untiered')} · ${escapeHtml(alert.suppressed ? `suppressed: ${alert.suppressionReason ?? 'unspecified'}` : alert.alertReason ?? 'sent')} · ${escapeHtml(formatDate(alert.createdAt))}</li>`)
    .join('')}</ul>`;
}

function renderAudits(audits: HumanReviewAudit[]): string {
  if (audits.length === 0) return '<h3>LLM Audit</h3><p class="empty">No LLM calls recorded for this case.</p>';
  return `<h3>LLM Audit</h3><ul>${audits
    .map((audit) => `<li>${escapeHtml(audit.taskName)} · ${escapeHtml(audit.validationStatus)} · ${escapeHtml(formatDate(audit.createdAt))}</li>`)
    .join('')}</ul>`;
}

function mapArticle(row: ArticleRow): HumanReviewArticle {
  return {
    id: row.id,
    title: row.title,
    canonicalUrl: row.canonical_url,
    sourceName: row.source_name,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    processingStatus: row.processing_status,
    extractionStatus: row.extraction_status,
    extractionMethod: row.extraction_method,
    extractionError: row.extraction_error,
    contentQualityScore: toNumber(row.content_quality_score),
    rssRecall: toNumber(row.rss_recall),
    rssSummary: row.rss_summary,
    cleanText: row.clean_text,
    llmClassification: row.llm_classification,
  };
}

function mapEntity(row: EntityRow): HumanReviewEntity {
  return {
    articleId: row.article_id,
    entityType: row.entity_type,
    entityValue: row.entity_value,
    confidence: toNumber(row.confidence),
    role: row.role,
  };
}

function mapEvent(row: EventRow): HumanReviewEvent {
  return {
    articleId: row.article_id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    eventSummary: row.event_summary,
    groupingKey: row.grouping_key,
    relationship: row.relationship,
    relationshipConfidence: toNumber(row.relationship_confidence),
    isPrimarySource: row.is_primary_source,
    isMaterialUpdate: row.is_material_update,
    severity: row.severity,
    urgency: row.urgency,
    eventConfidence: toNumber(row.event_confidence),
    affectedVendors: row.affected_vendors ?? [],
    affectedProducts: row.affected_products ?? [],
    cves: row.cves ?? [],
    attackTypes: row.attack_types ?? [],
  };
}

function mapAlert(row: AlertRow): HumanReviewAlert {
  return {
    eventId: row.event_id,
    alertStatus: row.alert_status,
    alertTier: row.alert_tier,
    alertReason: row.alert_reason,
    suppressed: row.suppressed,
    suppressionReason: row.suppression_reason,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

function mapAudit(row: AuditRow): HumanReviewAudit {
  return {
    targetType: row.target_type,
    targetId: row.target_id,
    taskName: row.task_name,
    validationStatus: row.validation_status,
    createdAt: row.created_at,
  };
}

function mapVerdict(row: VerdictRow): HumanReviewVerdictRecord {
  return {
    articleId: row.article_id,
    eventId: row.event_id,
    relevanceVerdict: row.relevance_verdict,
    vendorImpactVerdict: row.vendor_impact_verdict,
    llmClassificationVerdict: row.llm_classification_verdict,
    groupingVerdict: row.grouping_verdict,
    alertVerdict: row.alert_verdict,
    notes: row.notes,
    reviewer: row.reviewer,
    reviewedAt: row.reviewed_at,
  };
}

function countAlerts(cases: HumanReviewCase[], predicate: (alert: HumanReviewAlert) => boolean): number {
  return cases.flatMap((item) => item.alerts).filter(predicate).length;
}

function isLowExtractionQuality(reviewCase: HumanReviewCase): boolean {
  const { article } = reviewCase;
  return (
    (article.rssRecall !== null && article.rssRecall < 0.6) ||
    (article.contentQualityScore !== null && article.contentQualityScore < 0.3)
  );
}

function hasLlmOutput(reviewCase: HumanReviewCase): boolean {
  return reviewCase.article.llmClassification !== null && reviewCase.article.llmClassification !== undefined;
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  return Number(value);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function kv(label: string, value: string): string {
  return `<div class="kv"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

function badge(text: string, tone = ''): string {
  return `<span class="badge ${escapeAttribute(tone)}">${escapeHtml(text)}</span>`;
}

function severityTone(severity: string): string {
  return severity === 'critical' || severity === 'high' ? 'bad' : severity === 'medium' ? 'warn' : '';
}

function confidenceTone(confidence: number): string {
  if (confidence < 0.65) return 'warn';
  if (confidence >= 0.8) return 'good';
  return '';
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: Date | null): string {
  if (!value) return 'unknown date';
  return value.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#96;');
}
