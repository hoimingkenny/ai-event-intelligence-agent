import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/events" className="brand">
          Vendor Threat Watch
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <Link href="/events" className="active">
            Events
          </Link>
        </nav>
      </div>
    </header>
  );
}
