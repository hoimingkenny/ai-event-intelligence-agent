import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getWorkspaceArticle } from '../../../../../src/events/event-editorial';
import { SiteHeader } from '../../../../components/SiteHeader';
import { WorkspaceEntityList } from '../../../../components/WorkspaceEntityList';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { getDb } from '../../../../lib/db';
import { formatWhen } from '../../../../lib/format';
import { requireAnalyst } from '../../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

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

export default async function WorkspaceArticlePage({ params }: PageProps) {
  const { id } = await params;
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? `/login?callbackUrl=${encodeURIComponent(`/workspace/articles/${id}`)}`
        : '/auth/denied'
    );
  }

  const article = await getWorkspaceArticle(getDb(), id);
  if (!article) notFound();

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <Link className="back-link" href="/workspace/triage">
          ← Needs triage
        </Link>
        <p className="page-kicker">Workspace article</p>
        <h1 className="page-title">{article.title || 'Untitled article'}</h1>

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
        </div>
      </main>
    </>
  );
}
