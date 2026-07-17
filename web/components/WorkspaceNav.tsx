import Link from 'next/link';

const LINKS = [
  { href: '/workspace', label: 'Overview', id: 'overview' as const },
  { href: '/workspace/triage', label: 'Triage', id: 'triage' as const },
  { href: '/workspace/drafts', label: 'Drafts', id: 'drafts' as const },
  { href: '/workspace/approved', label: 'Approved', id: 'approved' as const },
  { href: '/workspace/eval/digest', label: 'Digest eval', id: 'digest-eval' as const },
  { href: '/workspace/config', label: 'Config', id: 'config' as const },
];

export type WorkspaceNavActive = (typeof LINKS)[number]['id'] | 'new' | 'event';

export function WorkspaceNav({ active }: { active: WorkspaceNavActive }) {
  return (
    <nav className="workspace-nav" aria-label="Workspace">
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
