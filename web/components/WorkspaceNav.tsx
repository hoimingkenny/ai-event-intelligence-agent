import Link from 'next/link';

const PRIMARY = [
  { href: '/workspace', label: 'Overview', id: 'overview' as const },
  { href: '/workspace/triage', label: 'Articles', id: 'triage' as const },
  { href: '/workspace/cves', label: 'CVE cases', id: 'cves' as const },
  { href: '/workspace/config', label: 'Config', id: 'config' as const },
];

const LEGACY = [
  { href: '/workspace/drafts', label: 'Drafts', id: 'drafts' as const },
  { href: '/workspace/approved', label: 'Approved', id: 'approved' as const },
  {
    href: '/workspace/eval/digest',
    label: 'Digest eval',
    id: 'digest-eval' as const,
  },
];

export type WorkspaceNavActive =
  | (typeof PRIMARY)[number]['id']
  | (typeof LEGACY)[number]['id']
  | 'new'
  | 'event';

const LEGACY_ACTIVE = new Set<WorkspaceNavActive>(['drafts', 'approved', 'digest-eval', 'new', 'event']);

export function WorkspaceNav({ active }: { active: WorkspaceNavActive }) {
  const legacyOpen = LEGACY_ACTIVE.has(active);

  return (
    <nav className="workspace-nav" aria-label="Workspace">
      {PRIMARY.map((link) => (
        <Link
          key={link.id}
          href={link.href}
          className={active === link.id ? 'active' : undefined}
          aria-current={active === link.id ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}

      <details className="workspace-nav-legacy" {...(legacyOpen ? { open: true } : {})}>
        <summary>Legacy</summary>
        <span className="workspace-nav-legacy-links">
          {LEGACY.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              className={active === link.id ? 'active' : undefined}
              aria-current={active === link.id ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </span>
      </details>
    </nav>
  );
}
