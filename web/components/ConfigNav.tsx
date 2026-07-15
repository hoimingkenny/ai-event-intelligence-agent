import Link from 'next/link';

const LINKS = [
  { href: '/workspace/config', label: 'Hub', id: 'hub' as const },
  { href: '/workspace/config/feeds', label: 'Feeds', id: 'feeds' as const },
  { href: '/workspace/config/inventory', label: 'Inventory', id: 'inventory' as const },
];

export type ConfigNavActive = (typeof LINKS)[number]['id'];

export function ConfigNav({ active }: { active: ConfigNavActive }) {
  return (
    <nav className="config-nav" aria-label="Workspace Config">
      {LINKS.map((link) => (
        <Link
          key={link.id}
          href={link.href}
          className={active === link.id ? 'active' : undefined}
          aria-current={active === link.id ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function ConfigApplyNote() {
  return (
    <p className="config-note">
      Takes effect on the next pipeline run. Existing <code>IGNORED</code> articles are not bulk
      re-scanned — use filter re-queue on a Workspace article after inventory fixes (when available).
    </p>
  );
}
