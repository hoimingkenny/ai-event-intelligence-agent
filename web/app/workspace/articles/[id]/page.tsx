import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { listActiveMonitoredInventory } from '../../../../../src/db/monitored-inventory';
import { draftDigestGoldFromStoredDigest } from '../../../../../src/evaluation/digest/digest-label-assist';
import type { DigestGoldFields } from '../../../../../src/evaluation/digest/digest-gold-types';
import { getWorkspaceArticle } from '../../../../../src/events/event-editorial';
import { getDigestGoldForArticle } from '../../../../../src/workspace/workspace-digest-eval-read';
import { ConfirmSubmitScript } from '../../../../components/ConfirmSubmitScript';
import { DigestGoldForm } from '../../../../components/DigestGoldForm';
import { SiteHeader } from '../../../../components/SiteHeader';
import { WorkspaceEntityList } from '../../../../components/WorkspaceEntityList';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { getDb } from '../../../../lib/db';
import { formatWhen } from '../../../../lib/format';
import { requireAnalyst } from '../../../../lib/require-analyst';
import { requeueArticleForFilterAction } from './actions';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    requeued?: string;
    error?: string;
    gold_saved?: string;
    gold_error?: string;
    assist_error?: string;
  }>;
};

const GOLD_ERROR_MESSAGES: Record<string, string> = {
  article_not_found: 'Article not found.',
  article_not_eligible: 'Article must be DIGESTED or have an LLM digest before saving gold.',
  related_requires_inventory_match:
    'Related gold must name at least one monitored vendor or product.',
  invalid_inventory_vendor: 'One or more vendors are not in the monitored inventory.',
  invalid_inventory_product: 'One or more products are not in the monitored inventory.',
};

function initialDigestGoldFields(
  gold: Awaited<ReturnType<typeof getDigestGoldForArticle>>,
  storedDigest: unknown
): DigestGoldFields {
  if (gold) {
    return {
      relatedToMonitoredInventory: gold.relatedToMonitoredInventory,
      matchedVendors: gold.matchedVendors,
      matchedProducts: gold.matchedProducts,
      cves: gold.cves,
      humanReason: gold.humanReason,
    };
  }
  const fromDigest = draftDigestGoldFromStoredDigest(storedDigest);
  if (fromDigest) return fromDigest;
  return {
    relatedToMonitoredInventory: false,
    matchedVendors: [],
    matchedProducts: [],
    cves: [],
    humanReason: null,
  };
}

export async function generateMetadata({ params }: PageProps) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    return { title: 'Workspace article' };
  }
  const { id } = await params;
  const article = await getWorkspaceArticle(getDb(), id);
  return {
    title: article?.title ? `${article.title} · Workspace` : 'Workspace article',
  };
}

function formatSignalList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '—';
}

export default async function WorkspaceArticlePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { requeued, error, gold_saved, gold_error, assist_error } = await searchParams;
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? `/login?callbackUrl=${encodeURIComponent(`/workspace/articles/${id}`)}`
        : '/auth/denied'
    );
  }

  const db = getDb();
  const article = await getWorkspaceArticle(db, id);
  if (!article) notFound();

  const [gold, inventory] = await Promise.all([
    getDigestGoldForArticle(db, id),
    listActiveMonitoredInventory(db),
  ]);
  const goldInitial = initialDigestGoldFields(gold, article.llmArticleDigest);
  const showDigestGold =
    article.processingStatus === 'DIGESTED' || article.llmArticleDigest != null;

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <Link className="back-link" href="/workspace/triage">
          ← Needs triage
        </Link>
        <p className="page-kicker">Workspace article</p>
        <h1 className="page-title">{article.title || 'Untitled article'}</h1>
        <p className="page-lede">
          <span className="chip">{article.processingStatus}</span>
        </p>

        <WorkspaceNav active="triage" />

        <div className="detail-panel">
          <dl className="kv-grid">
            <div>
              <dt>Source</dt>
              <dd>{article.sourceName || '—'}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>{formatWhen(article.publishedAt)}</dd>
            </div>
            <div>
              <dt>Fetched</dt>
              <dd>{formatWhen(article.fetchedAt)}</dd>
            </div>
            <div>
              <dt>Processing</dt>
              <dd>{article.processingStatus}</dd>
            </div>
            <div>
              <dt>Extraction</dt>
              <dd>
                {(article.extractionMethod || 'unknown') + ' / ' + article.extractionStatus}
              </dd>
            </div>
            <div>
              <dt>URL</dt>
              <dd>
                {article.canonicalUrl ? (
                  <a href={article.canonicalUrl} rel="noreferrer" target="_blank">
                    Open original
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>

          <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
            Body
            {article.bodySource === 'cleanText' ? (
              <span className="meta"> · extracted text</span>
            ) : article.bodySource === 'rssSummary' ? (
              <span className="meta"> · RSS summary</span>
            ) : null}
          </h2>
          {article.bodyText ? (
            <pre className="workspace-article-body">{article.bodyText}</pre>
          ) : (
            <p className="meta">No extracted text or RSS summary.</p>
          )}

          <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
            Filter signals
          </h2>
          <dl className="kv-grid">
            <div>
              <dt>Cheap filter</dt>
              <dd>{article.cheapFilterDecision ?? '—'}</dd>
            </div>
            <div>
              <dt>Vendors</dt>
              <dd>{formatSignalList(article.filterSignals.vendors)}</dd>
            </div>
            <div>
              <dt>Products</dt>
              <dd>{formatSignalList(article.filterSignals.products)}</dd>
            </div>
            <div>
              <dt>CVEs</dt>
              <dd>{formatSignalList(article.filterSignals.cves)}</dd>
            </div>
            <div>
              <dt>Critical keywords</dt>
              <dd>{formatSignalList(article.filterSignals.criticalKeywords)}</dd>
            </div>
          </dl>

          <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
            Extracted entities
          </h2>
          <WorkspaceEntityList entities={article.extractedEntities} />

          <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
            LLM digest (post-extraction)
          </h2>
          {article.llmArticleDigest == null ? (
            <p className="meta">
              No LLM digest yet (status: {article.processingStatus}).
            </p>
          ) : (
            <pre className="workspace-article-body">
              {JSON.stringify(article.llmArticleDigest, null, 2)}
            </pre>
          )}

          {showDigestGold ? (
            <>
              <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
                Digest gold
              </h2>
              <p className="meta" style={{ marginBottom: '0.75rem' }}>
                Human ground truth for digest eval. Saving freezes article text and inventory at
                this moment.
              </p>
              <DigestGoldForm
                articleId={article.id}
                inventory={inventory}
                initial={goldInitial}
                saved={gold_saved === '1'}
                saveError={gold_error ? GOLD_ERROR_MESSAGES[gold_error] ?? gold_error : undefined}
                assistError={assist_error}
              />
            </>
          ) : null}

          <h2 className="page-kicker" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
            LLM classification
          </h2>
          {article.llmClassification == null ? (
            <p className="meta">
              No LLM classification yet (status: {article.processingStatus}).
            </p>
          ) : (
            <pre className="workspace-article-body">
              {JSON.stringify(article.llmClassification, null, 2)}
            </pre>
          )}

          {article.processingStatus === 'IGNORED' ? (
            <form action={requeueArticleForFilterAction} className="requeue-form">
              <input type="hidden" name="articleId" value={article.id} />
              <button
                type="submit"
                className="requeue-button"
                data-confirm="Send this article back through the cheap filter with the current inventory? The previous filter decision will be cleared, and the next scheduled sweep will re-evaluate it."
              >
                Re-queue for filter
              </button>
            </form>
          ) : null}

          {requeued ? (
            <p className="flash flash-success">
              Re-queued. The next filter sweep will re-evaluate this article.
            </p>
          ) : null}
          {error === 'article_not_ignorable' ? (
            <p className="flash flash-error">
              This article is no longer in IGNORED status and cannot be re-queued.
            </p>
          ) : null}
        </div>
      </main>
      <ConfirmSubmitScript />
    </>
  );
}
