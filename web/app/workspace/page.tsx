import { redirect } from 'next/navigation';
import { SiteHeader } from '../../components/SiteHeader';
import { requireAnalyst } from '../../lib/require-analyst';
import { signOutAction } from '../actions/auth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Workspace',
};

export default async function WorkspacePage() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace' : '/auth/denied');
  }

  const login = gate.session.user.githubLogin || gate.session.user.name || 'analyst';

  return (
    <>
      <SiteHeader active="events" />
      <main className="page">
        <p className="page-kicker">Analyst workspace</p>
        <h1 className="page-title">Workspace</h1>
        <p className="page-lede">
          Signed in as <strong>{login}</strong>. Event edit / approve tools land in a later ticket;
          this route is the authenticated shell.
        </p>
        <div className="detail-panel">
          <p className="detail-summary" style={{ marginBottom: '1rem' }}>
            Only allowlisted GitHub usernames can reach this area. Editorial create/edit/approve
            comes next.
          </p>
          <form action={signOutAction}>
            <button className="auth-button secondary" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
