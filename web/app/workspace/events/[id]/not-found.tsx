import Link from 'next/link';
import { SiteHeader } from '../../../../components/SiteHeader';

export default function NotFound() {
  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <div className="empty-state">
          <h2>Event not found</h2>
          <p>This event does not exist in the workspace queue.</p>
          <p style={{ marginTop: '1rem' }}>
            <Link href="/workspace">Back to workspace</Link>
          </p>
        </div>
      </main>
    </>
  );
}
