import Link from 'next/link';
import { SiteHeader } from '../../components/SiteHeader';
import { signInWithGitHub } from '../actions/auth';

export const metadata = {
  title: 'Sign in',
};

type PageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const callbackUrl = params.callbackUrl || '/workspace';

  return (
    <>
      <SiteHeader active="events" />
      <main className="page">
        <p className="page-kicker">Analyst access</p>
        <h1 className="page-title">Sign in</h1>
        <p className="page-lede">
          Workspace access uses GitHub OAuth and an allowlisted set of usernames. Public Events and
          Articles stay open without signing in.
        </p>
        <div className="detail-panel">
          <form
            action={async () => {
              'use server';
              await signInWithGitHub(callbackUrl);
            }}
          >
            <button className="auth-button" type="submit">
              Continue with GitHub
            </button>
          </form>
          <p className="meta" style={{ marginTop: '1rem' }}>
            <Link href="/events">Back to public catalogue</Link>
          </p>
        </div>
      </main>
    </>
  );
}
