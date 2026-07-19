import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '../../../components/SiteHeader';
import { getDb } from '../../../lib/db';
import { formatWhen } from '../../../lib/format';
import { getPublicArticleDetail } from '../../../../src/public/public-cve-read';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const article = await getPublicArticleDetail(getDb(), id);
  return {
    title: article?.article.title ?? 'Article',
  };
}

export default async function PublicArticleDetailPage({ params }: PageProps) {
  const { id } = await params;
  const detail = await getPublicArticleDetail(getDb(), id);
  if (!detail) notFound();

  const { article, summary, approvedCves } = detail;

  return (
    <>
      <SiteHeader active="articles" />
      <main className="page">
        <p className="page-kicker">
          <Link href="/articles">← All articles</Link>
        </p>
        <h1 className="page-title">{article.title ?? article.canonicalUrl ?? `Article #${article.id}`}</h1>
        <p className="page-lede">
          {article.sourceName ? `${article.sourceName} · ` : ''}
          {formatWhen(article.publishedAt)}
        </p>

        {approvedCves.length > 0 ? (
          <p>
            Linked CVEs:{' '}
            {approvedCves.map((link, idx) => (
              <span key={link.cveId}>
                {idx > 0 ? ', ' : ''}
                <Link href={`/cves/${encodeURIComponent(link.cveId)}`}>{link.cveId}</Link>
              </span>
            ))}
          </p>
        ) : null}

        <section className="workspace-section">
          <h2 className="section-title">Analyst summary</h2>
          {summary ? (
            <pre className="workspace-article-body">{summary}</pre>
          ) : (
            <p className="empty-state">No analyst summary available yet.</p>
          )}
        </section>

        {article.canonicalUrl ? (
          <section className="workspace-section">
            <h2 className="section-title">Source</h2>
            <p>
              <a href={article.canonicalUrl} target="_blank" rel="noopener noreferrer">
                {article.canonicalUrl}
              </a>
            </p>
          </section>
        ) : null}
      </main>
    </>
  );
}