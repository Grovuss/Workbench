import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZES = [25, 50, 100, 0] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

interface Props {
  page: number;
  pageSize: PageSize;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: PageSize) => void;
}

/** Page numbers to show: the first, the last, and the ones around the current page. */
function pageList(current: number, count: number): (number | 'gap')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const pages = new Set([0, count - 1, current - 1, current, current + 1].filter((p) => p >= 0 && p < count));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

/** "Showing 1–50 of 120", a page-size picker and page buttons. pageSize 0 means everything on one page. */
export default function Pagination({ page, pageSize, total, onPage, onPageSize }: Props) {
  const count = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const from = pageSize ? page * pageSize + 1 : 1;
  const to = pageSize ? Math.min(total, (page + 1) * pageSize) : total;

  return (
    <div className="pagination">
      <span className="pagination-range">
        {total === 0 ? 'Nothing to show' : `Showing ${from === to ? from : `${from}–${to}`} of ${total}`}
      </span>
      <label className="select-pill">
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value) as PageSize)} aria-label="Items per page">
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size ? `${size} per page` : 'Show all'}
            </option>
          ))}
        </select>
      </label>
      {count > 1 && (
        <nav className="pagination-pages" aria-label="Pages">
          <button className="page-btn" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>
            <ChevronLeft size={16} />
          </button>
          {pageList(page, count).map((p, i) =>
            p === 'gap' ? (
              <span key={`gap-${i}`} className="page-gap">
                …
              </span>
            ) : (
              <button key={p} className="page-btn" aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>
                {p + 1}
              </button>
            ),
          )}
          <button className="page-btn" aria-label="Next page" disabled={page === count - 1} onClick={() => onPage(page + 1)}>
            <ChevronRight size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}
