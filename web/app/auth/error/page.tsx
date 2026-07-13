import Link from 'next/link';
import { SiteHeader } from '../../../components/SiteHeader';

export const metadata = {
  title: 'Sign-in error',
};

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function AuthErrorPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  return (
    <>
      <SiteHeader active="events" />
      <main className="page">
        <div className="empty-state">
          <h2>Could not sign in</h2>
          <p>
            GitHub authentication failed{error ? ` (${error})` : ''}. Check{' '}
            <code>AUTH_GITHUB_ID</code> / <code>AUTH_GITHUB_SECRET</code> and try again.
          </p>
          <p style={{ marginTop: '1rem' }}>
            <Link href="/login">Back to sign in</Link>
          </p>
        </div>
      </main>
    </>
  );
}
