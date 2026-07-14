import Link from 'next/link';
import { Bug, Buildings, NotePencil, Warning } from '@phosphor-icons/react/dist/ssr';
import type { TriageListItem } from '../../src/events/event-editorial';

const ICON_SIZE = 16;

type Props = {
  article: TriageListItem;
};

export function TriageSignalIcons({ article }: Props) {
  const { signals, draft } = article;
  const hasAny =
    signals.hasVendorOrProduct ||
    signals.hasCve ||
    signals.hasCriticalKeyword ||
    draft !== null;

  if (!hasAny) return null;

  return (
    <span className="triage-icons" aria-label="Article signals">
      {signals.hasVendorOrProduct ? (
        <span
          className="triage-icon"
          title={signals.vendorProductNames.join(', ') || 'Monitored vendor or product'}
        >
          <Buildings size={ICON_SIZE} weight="duotone" aria-hidden />
          <span className="sr-only">
            Vendor or product: {signals.vendorProductNames.join(', ')}
          </span>
        </span>
      ) : null}
      {signals.hasCve ? (
        <span className="triage-icon" title={signals.cveIds.join(', ') || 'CVE mentioned'}>
          <Bug size={ICON_SIZE} weight="duotone" aria-hidden />
          <span className="sr-only">CVE: {signals.cveIds.join(', ')}</span>
        </span>
      ) : null}
      {signals.hasCriticalKeyword ? (
        <span
          className="triage-icon triage-icon-warn"
          title={signals.criticalKeywords.join(', ') || 'Critical cyber keyword'}
        >
          <Warning size={ICON_SIZE} weight="duotone" aria-hidden />
          <span className="sr-only">
            Critical keywords: {signals.criticalKeywords.join(', ')}
          </span>
        </span>
      ) : null}
      {draft ? (
        <Link
          className="triage-icon triage-icon-draft"
          href={`/workspace/events/${draft.primaryEventId}`}
          title={
            draft.eventTitles.length > 1
              ? `Drafts: ${draft.eventTitles.join(' · ')}`
              : `Draft: ${draft.eventTitles[0]}`
          }
        >
          <NotePencil size={ICON_SIZE} weight="duotone" aria-hidden />
          <span className="sr-only">
            On draft event: {draft.eventTitles.join(', ')}
          </span>
        </Link>
      ) : null}
    </span>
  );
}
