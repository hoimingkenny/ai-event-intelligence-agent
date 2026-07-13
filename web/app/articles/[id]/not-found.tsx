import Link from 'next/link';
import { SiteHeader } from '../../../components/SiteHeader';

export default function NotFound() {
  return (
    <>
      <SiteHeader active="articles" />
      <main className="page">
        <div className="empty-state">
          <h2>Article not found</h2>
          <p>
            This article is missing, or it is not attached to any approved event in the public
            catalogue.
          </p>
          <p style={{ marginTop: '1rem' }}>
            <Link href="/articles">Back to articles</Link>
          </p>
        </div>
      </main>
    </>
  );
}
