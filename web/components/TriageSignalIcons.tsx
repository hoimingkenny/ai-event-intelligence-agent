import { Bug, ChartLineUp, Lightning, ShieldWarning } from '@phosphor-icons/react/dist/ssr';
import type { TriageListItem } from '../../src/events/event-editorial';

const ICON_SIZE = 16;

type Props = {
  article: TriageListItem;
};

export function TriageSignalIcons({ article }: Props) {
  const { mvpSignals } = article;
  const kevListed = mvpSignals.kevCveIds.length > 0;

  return (
    <span className="triage-icons" aria-label="CVE MVP signals">
      <span
        className={mvpSignals.actionable ? 'triage-icon triage-icon-on' : 'triage-icon triage-icon-off'}
        title={
          mvpSignals.actionable
            ? 'Disposition: actionable'
            : mvpSignals.disposition
              ? `Disposition: ${mvpSignals.disposition}`
              : 'Disposition not assessed yet'
        }
      >
        <Lightning
          size={ICON_SIZE}
          weight={mvpSignals.actionable ? 'fill' : 'regular'}
          aria-hidden
        />
        <span className="sr-only">
          {mvpSignals.actionable ? 'Actionable' : 'Not actionable or not assessed'}
        </span>
      </span>

      <span
        className={
          !mvpSignals.hasCve
            ? 'triage-icon triage-icon-off'
            : mvpSignals.cvssGrade === 'critical'
              ? 'triage-icon triage-icon-cve-critical'
              : mvpSignals.cvssGrade === 'high'
                ? 'triage-icon triage-icon-cve-high'
                : 'triage-icon triage-icon-on'
        }
        title={
          mvpSignals.hasCve
            ? mvpSignals.cvssGrade
              ? `CVE mentions (${mvpSignals.cvssGrade}): ${mvpSignals.cveIds.join(', ')}`
              : `CVE mentions: ${mvpSignals.cveIds.join(', ')}`
            : 'No CVE mentions'
        }
      >
        <Bug size={ICON_SIZE} weight={mvpSignals.hasCve ? 'fill' : 'regular'} aria-hidden />
        <span className="sr-only">
          {mvpSignals.hasCve
            ? mvpSignals.cvssGrade
              ? `Has CVE (${mvpSignals.cvssGrade}): ${mvpSignals.cveIds.join(', ')}`
              : `Has CVE: ${mvpSignals.cveIds.join(', ')}`
            : 'No CVE mentions'}
        </span>
      </span>

      <span
        className={
          kevListed
            ? 'triage-icon triage-icon-cve-critical'
            : mvpSignals.hasCve
              ? 'triage-icon triage-icon-on'
              : 'triage-icon triage-icon-off'
        }
        title={
          kevListed
            ? `CISA KEV listed: ${mvpSignals.kevCveIds.join(', ')}`
            : mvpSignals.hasCve
              ? 'CISA KEV: none of the mentioned CVEs are listed'
              : 'CISA KEV: no CVE mentions'
        }
      >
        <ShieldWarning
          size={ICON_SIZE}
          weight={kevListed || mvpSignals.hasCve ? 'fill' : 'regular'}
          aria-hidden
        />
        <span className="sr-only">
          {kevListed
            ? `KEV listed: ${mvpSignals.kevCveIds.join(', ')}`
            : 'KEV not listed'}
        </span>
      </span>

      <span
        className={
          mvpSignals.epssGrade === 'critical'
            ? 'triage-icon triage-icon-cve-critical'
            : mvpSignals.epssGrade === 'high'
              ? 'triage-icon triage-icon-cve-high'
              : mvpSignals.hasCve
                ? 'triage-icon triage-icon-on'
                : 'triage-icon triage-icon-off'
        }
        title={
          mvpSignals.epssGrade
            ? `EPSS ${mvpSignals.epssGrade} (≥${mvpSignals.epssGrade === 'critical' ? '0.10 / p0.95' : '0.05 / p0.90'})`
            : mvpSignals.hasCve
              ? 'EPSS below triage thresholds'
              : 'EPSS: no CVE mentions'
        }
      >
        <ChartLineUp
          size={ICON_SIZE}
          weight={mvpSignals.epssGrade || mvpSignals.hasCve ? 'fill' : 'regular'}
          aria-hidden
        />
        <span className="sr-only">
          {mvpSignals.epssGrade ? `EPSS ${mvpSignals.epssGrade}` : 'EPSS not elevated'}
        </span>
      </span>
    </span>
  );
}
