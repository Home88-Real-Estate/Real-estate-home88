import Link from "next/link";

export function Pagination({
  page,
  pages,
  total,
  basePath,
  params,
}: {
  page: number;
  pages: number;
  total: number;
  basePath: string;
  params?: Record<string, string>;
}) {
  const href = (target: number) => {
    const query = new URLSearchParams(params ?? {});
    query.set("page", String(target));
    return `${basePath}?${query.toString()}`;
  };

  return (
    <div className="pager">
      <span className="muted">{total} total</span>
      {page > 1 ? (
        <Link className="btn btn--outline btn--sm" href={href(page - 1)}>
          Previous
        </Link>
      ) : (
        <span className="btn btn--outline btn--sm" style={{ opacity: 0.45 }} aria-disabled="true">
          Previous
        </span>
      )}
      <span>
        Page {page} / {pages}
      </span>
      {page < pages ? (
        <Link className="btn btn--outline btn--sm" href={href(page + 1)}>
          Next
        </Link>
      ) : (
        <span className="btn btn--outline btn--sm" style={{ opacity: 0.45 }} aria-disabled="true">
          Next
        </span>
      )}
    </div>
  );
}
