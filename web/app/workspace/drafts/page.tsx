import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listWorkspaceEventsPage } from '../../../../src/events/event-editorial';
import { SiteHeader } from '../../../components/SiteHeader';
import { WorkspaceEventList } from '../../../components/WorkspaceEventList';
import { WorkspaceNav } from '../../../components/WorkspaceNav';
import { WorkspacePagination } from '../../../components/WorkspacePagination';
import { getDb } from '../../../lib/db';
import { requireAnalyst } from '../../../lib/require-analyst';
import {
  WORKSPACE_PAGE_SIZE,
  parseWorkspacePage,
  workspacePageOffset,
} from '../../../lib/workspace-page';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Drafts · Workspace',
};

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function WorkspaceDraftsPage({ searchParams }: PageProps) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace/drafts' : '/auth/denied'
    );
  }

  const { page: pageRaw } = await searchParams;
  const page = parseWorkspacePage(pageRaw);
  const result = await listWorkspaceEventsPage(getDb(), {
    publicationStatus: 'draft',
    limit: WORKSPACE_PAGE_SIZE,
    offset: workspacePageOffset(page),
  });

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Analyst workspace</p>
        <h1 className="page-title">Draft events</h1>
        <p className="page-lede">
          Events not yet published. Edit fields, attach sources, then approve when ready for the
          public catalogue.
        </p>

        <WorkspaceNav active="drafts" />

        <WorkspaceEventList
          events={result.items}
          emptyTitle="No draft events"
          emptyBody={
            <>
              Pipeline-created drafts appear here, or{' '}
              <Link href="/workspace/new">create an event from articles</Link>.
            </>
          }
        />

        <WorkspacePagination
          basePath="/workspace/drafts"
          page={page}
          total={result.total}
          limit={result.limit}
        />
      </main>
    </>
  );
}
