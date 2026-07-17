import Link from 'next/link';

const LINKS = [
  { href: '/workspace/eval/digest', label: 'Label queue', id: 'queue' as const },
  { href: '/workspace/eval/digest/reports', label: 'Reports', id: 'reports' as const },
];

export type DigestEvalNavActive = (typeof LINKS)[number]['id'];

export function DigestEvalNav({ active }: { active: DigestEvalNavActive }) {
  return (
    <nav className="config-nav" aria-label="Digest eval">
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
