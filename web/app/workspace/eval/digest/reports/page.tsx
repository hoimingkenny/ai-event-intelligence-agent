import { redirect } from 'next/navigation';
import { DigestEvalNav } from '../../../../../components/DigestEvalNav';
import { DigestEvalReportsPanel } from '../../../../../components/DigestEvalReportsPanel';
import { SiteHeader } from '../../../../../components/SiteHeader';
import { WorkspaceNav } from '../../../../../components/WorkspaceNav';
import { getDb } from '../../../../../lib/db';
import { requireAnalyst } from '../../../../../lib/require-analyst';
import { getDigestEvalReportsSnapshot } from '../../../../../../src/workspace/workspace-digest-eval-reports';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Digest eval reports · Workspace',
};

type PageProps = {
  searchParams: Promise<{
    run?: string;
    ran?: string;
    error?: string;
  }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  no_gold: 'No digest gold labels yet. Label articles in the queue first.',
  missing_api_key: 'MINIMAX_API_KEY is required for regen eval.',
  run_failed: 'Digest eval run failed. Check server logs and try again.',
};

const RAN_MESSAGES: Record<string, string> = {
  baseline: 'Baseline digest eval finished.',
  regen: 'Regen digest eval finished.',
};

export default async function DigestEvalReportsPage({ searchParams }: PageProps) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? '/login?callbackUrl=/workspace/eval/digest/reports'
        : '/auth/denied'
    );
  }

  const params = await searchParams;
  const snapshot = await getDigestEvalReportsSnapshot(getDb(), {
    selectedRunId: params.run ?? null,
  });

  const flash =
    params.ran && !params.error ? RAN_MESSAGES[params.ran] ?? 'Eval run finished.' : null;
  const error = params.error
    ? ERROR_MESSAGES[params.error] ?? 'Digest eval run failed.'
    : null;

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Analyst workspace</p>
        <h1 className="page-title">Digest eval reports</h1>
        <p className="page-lede">
          Score stored digests against gold, run offline prompt regenerations, and optionally ask
          an agreement judge for diagnostics.
        </p>

        <WorkspaceNav active="digest-eval" />
        <DigestEvalNav active="reports" />

        <DigestEvalReportsPanel
          labeledCount={snapshot.labeledCount}
          softGateMinGold={snapshot.softGateMinGold}
          softGatesActive={snapshot.softGatesActive}
          runs={snapshot.runs.map((run) => ({
            id: run.id,
            mode: run.mode,
            promptVersion: run.promptVersion,
            modelName: run.modelName,
            finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
          }))}
          selectedRunId={snapshot.selectedRun?.id ?? null}
          selectedReport={snapshot.selectedReport}
          flash={flash}
          error={error}
        />
      </main>
    </>
  );
}
