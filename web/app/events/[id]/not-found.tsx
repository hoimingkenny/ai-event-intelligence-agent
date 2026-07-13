import Link from 'next/link';
import { SiteHeader } from '../../../components/SiteHeader';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <div className="empty-state">
          <h2>Event not found</h2>
          <p>This event is missing, still a draft, or not part of the public catalogue.</p>
          <p style={{ marginTop: '1rem' }}>
            <Link href="/events">Back to events</Link>
          </p>
        </div>
      </main>
    </>
  );
}
