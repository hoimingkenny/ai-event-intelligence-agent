import Link from 'next/link';
import { WORKSPACE_PAGE_SIZE, workspaceTotalPages } from '../lib/workspace-page';

type Props = {
  basePath: string;
  page: number;
  total: number;
  limit?: number;
};

export function WorkspacePagination({
  basePath,
  page,
  total,
  limit = WORKSPACE_PAGE_SIZE,
}: Props) {
  if (total === 0) return null;

  const totalPages = workspaceTotalPages(total, limit);
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const prevHref = page > 1 ? `${basePath}?page=${page - 1}` : null;
  const nextHref = page < totalPages ? `${basePath}?page=${page + 1}` : null;

  return (
    <div className="workspace-pagination">
      <p className="meta">
        Showing {from}–{to} of {total}
      </p>
      <div className="workspace-pagination-links">
        {prevHref ? (
          <Link href={prevHref}>← Prev</Link>
        ) : (
          <span className="meta">← Prev</span>
        )}
        <span className="meta">
          Page {page} of {totalPages}
        </span>
        {nextHref ? (
          <Link href={nextHref}>Next →</Link>
        ) : (
          <span className="meta">Next →</span>
        )}
      </div>
    </div>
  );
}
