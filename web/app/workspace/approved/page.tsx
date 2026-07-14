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
  title: 'Approved · Workspace',
};

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function WorkspaceApprovedPage({ searchParams }: PageProps) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? '/login?callbackUrl=/workspace/approved'
        : '/auth/denied'
    );
  }

  const { page: pageRaw } = await searchParams;
  const page = parseWorkspacePage(pageRaw);
  const result = await listWorkspaceEventsPage(getDb(), {
    publicationStatus: 'approved',
    limit: WORKSPACE_PAGE_SIZE,
    offset: workspacePageOffset(page),
  });

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Analyst workspace</p>
        <h1 className="page-title">Approved events</h1>
        <p className="page-lede">
          Live on the{' '}
          <Link href="/events" target="_blank">
            public catalogue
          </Link>
          . Open an event to edit or unpublish.
        </p>

        <WorkspaceNav active="approved" />

        <WorkspaceEventList
          events={result.items}
          emptyTitle="No approved events"
          emptyBody={
            <>
              Approve a draft from the{' '}
              <Link href="/workspace/drafts">drafts queue</Link> to publish it here and on the public
              catalogue.
            </>
          }
        />

        <WorkspacePagination
          basePath="/workspace/approved"
          page={page}
          total={result.total}
          limit={result.limit}
        />
      </main>
    </>
  );
}
