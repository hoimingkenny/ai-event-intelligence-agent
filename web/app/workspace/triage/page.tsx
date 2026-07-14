import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listArticlesNeedingTriagePage } from '../../../../src/events/event-editorial';
import { SiteHeader } from '../../../components/SiteHeader';
import { TriageSignalIcons } from '../../../components/TriageSignalIcons';
import { WorkspaceNav } from '../../../components/WorkspaceNav';
import { WorkspacePagination } from '../../../components/WorkspacePagination';
import { getDb } from '../../../lib/db';
import { formatWhen } from '../../../lib/format';
import { requireAnalyst } from '../../../lib/require-analyst';
import {
  WORKSPACE_PAGE_SIZE,
  parseWorkspacePage,
  workspacePageOffset,
} from '../../../lib/workspace-page';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Triage · Workspace',
};

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function WorkspaceTriagePage({ searchParams }: PageProps) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace/triage' : '/auth/denied'
    );
  }

  const { page: pageRaw } = await searchParams;
  const page = parseWorkspacePage(pageRaw);
  const offset = workspacePageOffset(page);
  const result = await listArticlesNeedingTriagePage(getDb(), {
    limit: WORKSPACE_PAGE_SIZE,
    offset,
  });

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Analyst workspace</p>
        <h1 className="page-title">Needs triage</h1>
        <p className="page-lede">
          Articles not yet on any approved event. Use{' '}
          <Link href="/workspace/new">Create event</Link> to open a draft from one or more of them.
        </p>

        <WorkspaceNav active="triage" />

        {result.items.length === 0 ? (
          <p className="meta">No untriaged articles right now.</p>
        ) : (
          <ul className="triage-grid">
            {result.items.map((article) => (
              <li key={article.id}>
                <time
                  className="triage-mono"
                  dateTime={
                    article.publishedAt ? new Date(article.publishedAt).toISOString() : undefined
                  }
                >
                  {formatWhen(article.publishedAt)}
                </time>
                <Link className="triage-title" href={`/workspace/articles/${article.id}`}>
                  {article.title || article.canonicalUrl || 'Untitled article'}
                </Link>
                <span className="triage-end">
                  <TriageSignalIcons article={article} />
                  <span>{article.sourceName || 'Unknown source'}</span>
                  <span className="triage-mono">#{article.id}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <WorkspacePagination
          basePath="/workspace/triage"
          page={page}
          total={result.total}
          limit={result.limit}
        />
      </main>
    </>
  );
}
