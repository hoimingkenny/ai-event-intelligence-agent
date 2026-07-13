import Link from 'next/link';
import { SiteHeader } from '../../../components/SiteHeader';
import { signOutAction } from '../../actions/auth';

export const metadata = {
  title: 'Access denied',
};

export default function DeniedPage() {
  return (
    <>
      <SiteHeader active="events" />
      <main className="page">
        <div className="empty-state">
          <h2>Not on the analyst allowlist</h2>
          <p>
            Your GitHub account authenticated, but it is not listed in{' '}
            <code>ANALYST_GITHUB_USERS</code>. Workspace stays closed.
          </p>
          <p style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <Link href="/events">Public catalogue</Link>
            <form action={signOutAction}>
              <button className="auth-button secondary" type="submit">
                Sign out
              </button>
            </form>
          </p>
        </div>
      </main>
    </>
  );
}
