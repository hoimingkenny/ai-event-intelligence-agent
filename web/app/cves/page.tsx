import Link from 'next/link';
import { SiteHeader } from '../../components/SiteHeader';
import { WorkspacePagination } from '../../components/WorkspacePagination';
import { getDb } from '../../lib/db';
import {
  WORKSPACE_PAGE_SIZE,
  parseWorkspacePage,
  workspacePageOffset,
} from '../../lib/workspace-page';
import { formatDate } from '../../lib/format';
import { cvssTriageGrade } from '../../../src/cve/cvss-grade';
import {
  listPublicCves,
  publishDateKey,
  type PublicCveListEntry,
} from '../../../src/public/public-cve-read';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'High-alert CVEs',
};

const SORT_KEYS = ['attention', 'cve', 'kev', 'epss', 'cvss', 'published'] as const;
type SortKey = (typeof SORT_KEYS)[number];
type SortDir = 'asc' | 'desc';

type PageProps = {
  searchParams: Promise<{ page?: string; sort?: string; dir?: string }>;
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseSort(raw: string | undefined): SortKey {
  if (raw && (SORT_KEYS as readonly string[]).includes(raw)) return raw as SortKey;
  return 'attention';
}

function defaultDir(sort: SortKey): SortDir {
  return sort === 'cve' ? 'asc' : 'desc';
}

function parseDir(raw: string | undefined, sort: SortKey): SortDir {
  if (raw === 'asc' || raw === 'desc') return raw;
  return defaultDir(sort);
}

function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: SortDir
): number {
  const aVal = a ?? -1;
  const bVal = b ?? -1;
  return dir === 'asc' ? aVal - bVal : bVal - aVal;
}

function sortPublicCves(
  entries: PublicCveListEntry[],
  sort: SortKey,
  dir: SortDir
): PublicCveListEntry[] {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    if (sort === 'attention') {
      const aDay = publishDateKey(a.approvedAt);
      const bDay = publishDateKey(b.approvedAt);
      if (aDay !== bDay) return bDay.localeCompare(aDay);
      if (a.signals.kevListed !== b.signals.kevListed) return a.signals.kevListed ? -1 : 1;
      const epss = compareNullableNumber(a.signals.epssScore, b.signals.epssScore, 'desc');
      if (epss !== 0) return epss;
      const cvss = compareNullableNumber(a.signals.cvssV3Base, b.signals.cvssV3Base, 'desc');
      if (cvss !== 0) return cvss;
      return a.cveId.localeCompare(b.cveId);
    }
    if (sort === 'cve') {
      const cmp = a.cveId.localeCompare(b.cveId);
      return dir === 'asc' ? cmp : -cmp;
    }
    if (sort === 'kev') {
      if (a.signals.kevListed !== b.signals.kevListed) {
        const listedFirst = a.signals.kevListed ? -1 : 1;
        return dir === 'desc' ? listedFirst : -listedFirst;
      }
      return a.cveId.localeCompare(b.cveId);
    }
    if (sort === 'epss') {
      const cmp = compareNullableNumber(a.signals.epssScore, b.signals.epssScore, dir);
      return cmp !== 0 ? cmp : a.cveId.localeCompare(b.cveId);
    }
    if (sort === 'cvss') {
      const cmp = compareNullableNumber(a.signals.cvssV3Base, b.signals.cvssV3Base, dir);
      return cmp !== 0 ? cmp : a.cveId.localeCompare(b.cveId);
    }
    // published — calendar day only
    const aDay = publishDateKey(a.approvedAt);
    const bDay = publishDateKey(b.approvedAt);
    const cmp = dir === 'asc' ? aDay.localeCompare(bDay) : bDay.localeCompare(aDay);
    return cmp !== 0 ? cmp : a.cveId.localeCompare(b.cveId);
  });
  return sorted;
}

function sortHref(target: SortKey, current: SortKey, dir: SortDir): string {
  const nextDir =
    target === current ? (dir === 'asc' ? 'desc' : 'asc') : defaultDir(target);
  const params = new URLSearchParams();
  if (target !== 'attention') params.set('sort', target);
  if (nextDir !== defaultDir(target)) params.set('dir', nextDir);
  const qs = params.toString();
  return qs ? `/cves?${qs}` : '/cves';
}

function paginationBasePath(sort: SortKey, dir: SortDir): string {
  const params = new URLSearchParams();
  if (sort !== 'attention') params.set('sort', sort);
  if (dir !== defaultDir(sort)) params.set('dir', dir);
  const qs = params.toString();
  return qs ? `/cves?${qs}` : '/cves';
}

function SortHeader({
  label,
  sortKey,
  current,
  dir,
  numeric,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  numeric?: boolean;
}) {
  const active = current === sortKey;
  const marker = active ? (dir === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <th scope="col" className={numeric ? 'workspace-table-num' : undefined}>
      <Link className="cve-sort-link" href={sortHref(sortKey, current, dir)}>
        {label}
        {marker}
      </Link>
    </th>
  );
}

export default async function PublicCvesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const sort = parseSort(params.sort);
  const dir = parseDir(params.dir, sort);
  const page = parseWorkspacePage(params.page);

  const all = sortPublicCves(await listPublicCves(getDb()), sort, dir);
  const offset = workspacePageOffset(page);
  const pageRows = all.slice(offset, offset + WORKSPACE_PAGE_SIZE);

  return (
    <>
      <SiteHeader active="cves" />
      <main className="page">
        <p className="page-kicker">Public catalogue</p>
        <h1 className="page-title">High-alert CVEs</h1>

        {all.length === 0 ? (
          <div className="empty-state">
            <h2>No high-alert CVEs yet</h2>
            <p>
              Cases reach this catalogue when enrichment reports CVSS ≥ 9 or a CISA KEV
              listing. Until then the list stays empty.
            </p>
          </div>
        ) : (
          <>
            <div className="workspace-table-wrap">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <SortHeader label="CVE" sortKey="cve" current={sort} dir={dir} />
                    <SortHeader label="KEV" sortKey="kev" current={sort} dir={dir} />
                    <SortHeader label="EPSS" sortKey="epss" current={sort} dir={dir} numeric />
                    <SortHeader label="CVSS" sortKey="cvss" current={sort} dir={dir} numeric />
                    <SortHeader
                      label="Published"
                      sortKey="published"
                      current={sort}
                      dir={dir}
                    />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((cve) => {
                    const cvssGrade =
                      cve.signals.cvssV3Base != null
                        ? cvssTriageGrade(cve.signals.cvssV3Base)
                        : null;
                    return (
                      <tr key={cve.cveId}>
                        <td>
                          <Link
                            className="workspace-table-cve"
                            href={`/cves/${encodeURIComponent(cve.cveId)}`}
                          >
                            {cve.cveId}
                          </Link>
                        </td>
                        <td>
                          {cve.signals.kevListed ? (
                            <span className="chip">Listed</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="workspace-table-num">
                          {cve.signals.epssScore != null
                            ? cve.signals.epssScore.toFixed(4)
                            : '—'}
                        </td>
                        <td className="workspace-table-num">
                          {cvssGrade && cve.signals.cvssV3Base != null ? (
                            <span className={`chip ${cvssGrade}`}>
                              {titleCase(cvssGrade)} {cve.signals.cvssV3Base.toFixed(1)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{formatDate(cve.approvedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="meta" style={{ marginTop: '0.75rem' }}>
              {sort === 'attention' ? (
                <>Default order: Published date → KEV → EPSS → CVSS → CVE.</>
              ) : (
                <Link href="/cves">Reset to default order</Link>
              )}
            </p>

            <WorkspacePagination
              basePath={paginationBasePath(sort, dir)}
              page={page}
              total={all.length}
              limit={WORKSPACE_PAGE_SIZE}
            />
          </>
        )}
      </main>
    </>
  );
}
