import Link from 'next/link';

export function SiteHeader({ active }: { active: 'events' | 'articles' | 'workspace' }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/events" className="brand">
          Vendor Threat Watch
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <Link href="/events" className={active === 'events' ? 'active' : undefined}>
            Events
          </Link>
          <Link href="/articles" className={active === 'articles' ? 'active' : undefined}>
            Articles
          </Link>
          <Link href="/workspace" className={active === 'workspace' ? 'active' : undefined}>
            Workspace
          </Link>
        </nav>
      </div>
    </header>
  );
}
