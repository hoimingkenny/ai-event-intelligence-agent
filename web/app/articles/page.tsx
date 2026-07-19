import Link from 'next/link';
import { SiteHeader } from '../../components/SiteHeader';
import { WorkspacePagination } from '../../components/WorkspacePagination';
import { getDb } from '../../lib/db';
import { formatWhen } from '../../lib/format';
import {
  WORKSPACE_PAGE_SIZE,
  parseWorkspacePage,
  workspacePageOffset,
} from '../../lib/workspace-page';
import { listPublicArticles } from '../../../src/public/public-cve-read';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Articles',
};

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function PublicArticlesPage({ searchParams }: PageProps) {
  const { page: pageRaw } = await searchParams;
  const page = parseWorkspacePage(pageRaw);
  const offset = workspacePageOffset(page);

  const all = await listPublicArticles(getDb());
  const pageRows = all.slice(offset, offset + WORKSPACE_PAGE_SIZE);

  return (
    <>
      <SiteHeader active="articles" />
      <main className="page">
        <p className="page-kicker">Public catalogue</p>
        <h1 className="page-title">Articles</h1>

        {all.length === 0 ? (
          <div className="empty-state">
            <h2>No public articles yet</h2>
            <p>
              Articles appear here once they are linked to a high-alert CVE. Until then the feed
              stays empty.
            </p>
          </div>
        ) : (
          <>
            <ul className="event-list">
              {pageRows.map((article) => (
                <li key={article.articleId} className="event-row">
                  <div>
                    <Link className="title" href={`/articles/${article.articleId}`}>
                      {article.title ?? article.canonicalUrl ?? `Article #${article.articleId}`}
                    </Link>
                    <div className="meta">
                      {article.sourceName ? <span>{article.sourceName}</span> : null}
                      {article.cveIds.length > 0 ? (
                        <span>
                          Linked CVEs:{' '}
                          {article.cveIds.map((cveId, idx) => (
                            <span key={cveId}>
                              {idx > 0 ? ', ' : ''}
                              <Link href={`/cves/${encodeURIComponent(cveId)}`}>{cveId}</Link>
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="meta" style={{ justifyContent: 'flex-end' }}>
                    <span>{formatWhen(article.publishedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>

            <WorkspacePagination
              basePath="/articles"
              page={page}
              total={all.length}
              limit={WORKSPACE_PAGE_SIZE}
            />
          </>
        )}
      </main>
    </>
  );
}
