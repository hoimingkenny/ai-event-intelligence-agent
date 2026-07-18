import Link from 'next/link';
import { SiteHeader } from '../../components/SiteHeader';
import { getDb } from '../../lib/db';
import { listPublicCves } from '../../../src/public/public-cve-read';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'CVEs',
};

export default async function PublicCvesPage() {
  const cves = await listPublicCves(getDb());

  return (
    <>
      <SiteHeader active="cves" />
      <main className="page">
        <p className="page-kicker">Public catalogue</p>
        <h1 className="page-title">Approved CVEs</h1>
        <p className="page-lede">
          Only CVEs that an analyst has approved are published here. Sorted by Attention order
          (KEV, EPSS, CVSS, identifier).
        </p>

        {cves.length === 0 ? (
          <div className="empty-state">
            <h2>No approved CVEs yet</h2>
            <p>
              Approved cases with at least one human-confirmed source link will appear here. Until
              then the catalogue stays empty.
            </p>
          </div>
        ) : (
          <ul className="event-list">
            {cves.map((cve) => (
              <li key={cve.cveId} className="event-row">
                <div>
                  <Link className="title" href={`/cves/${encodeURIComponent(cve.cveId)}`}>
                    {cve.cveId}
                  </Link>
                  <div className="meta">
                    {cve.signals.kevListed ? <span>KEV</span> : null}
                    {cve.signals.epssScore != null ? (
                      <span>EPSS: {cve.signals.epssScore.toFixed(4)}</span>
                    ) : null}
                    {cve.signals.cvssV3Base != null ? (
                      <span>CVSS v3: {cve.signals.cvssV3Base.toFixed(1)}</span>
                    ) : null}
                    {cve.approvedByActor ? <span>Approved by {cve.approvedByActor}</span> : null}
                  </div>
                </div>
                <div className="meta" style={{ justifyContent: 'flex-end' }}>
                  <span>
                    {cve.approvedAt ? cve.approvedAt.toISOString().slice(0, 10) : '—'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}