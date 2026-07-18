import Link from 'next/link';

export function SiteHeader({ active }: { active: 'events' | 'articles' | 'cves' | 'workspace' }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/events" className="brand">
          Vendor Threat Watch
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <Link href="/articles" className={active === 'articles' ? 'active' : undefined}>
            Articles
          </Link>
          <Link href="/cves" className={active === 'cves' ? 'active' : undefined}>
            CVEs
          </Link>
          <Link href="/workspace" className={active === 'workspace' ? 'active' : undefined}>
            Workspace
          </Link>
        </nav>
      </div>
    </header>
  );
}
