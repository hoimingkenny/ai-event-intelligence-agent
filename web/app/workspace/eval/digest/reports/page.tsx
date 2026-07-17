import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DigestEvalNav } from '../../../../components/DigestEvalNav';
import { SiteHeader } from '../../../../components/SiteHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { requireAnalyst } from '../../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Digest eval reports · Workspace',
};

export default async function DigestEvalReportsPage() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? '/login?callbackUrl=/workspace/eval/digest/reports'
        : '/auth/denied'
    );
  }

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Analyst workspace</p>
        <h1 className="page-title">Digest eval reports</h1>
        <p className="page-lede">
          Baseline scoring, regen runs, and agreement reports land in ticket #54. Use the{' '}
          <Link href="/workspace/eval/digest">label queue</Link> to build gold labels first.
        </p>

        <WorkspaceNav active="digest-eval" />
        <DigestEvalNav active="reports" />
      </main>
    </>
  );
}
