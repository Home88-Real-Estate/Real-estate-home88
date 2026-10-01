import Link from "next/link";
import type { Paginated } from "@home88/types";

import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatArea, formatMoney, personName } from "@/lib/format";
import { requireRole } from "@/lib/session";

type PropertyRow = {
  id: string;
  reference: string;
  titleEl: string;
  status: string;
  listingType: string;
  propertyType: string;
  price: unknown;
  area: unknown;
  city: string | null;
  updatedAt: string;
  agent: { firstName: string; lastName: string } | null;
  _count: { media: number; leads: number };
};

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ["DRAFT", "Draft"],
  ["ACTIVE", "Active"],
  ["RESERVED", "Reserved"],
  ["SOLD", "Sold"],
  ["RENTED", "Rented"],
  ["INACTIVE", "Inactive"],
  ["ARCHIVED", "Archived"],
] as const;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("AGENT");
  const sp = await searchParams;

  const q = first(sp.q);
  const status = first(sp.status);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const result = await apiFetch<Paginated<PropertyRow>>("/api/properties", {
    query: { q, status, page, limit: 25 },
  });

  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status) params.status = status;

  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>Properties</h1>
        <Link href="/properties/new" className="btn btn--primary">
          New property
        </Link>
      </div>

      <form className="filters" method="get" action="/properties">
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="Reference, title, city" />
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" className="select" defaultValue={status}>
            {STATUS_OPTIONS.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn--outline">
          Filter
        </button>
      </form>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <div className="empty">No properties match.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th className="num">Price</th>
                  <th className="num">Area</th>
                  <th className="num">Leads</th>
                  <th>Agent</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">
                      <Link href={`/properties/${row.id}`}>{row.reference}</Link>
                    </td>
                    <td>
                      <Link href={`/properties/${row.id}`}>{row.titleEl}</Link>
                    </td>
                    <td>
                      <StatusBadge value={row.status} kind="property" />
                    </td>
                    <td>{row.city ?? "-"}</td>
                    <td className="num">{formatMoney(row.price)}</td>
                    <td className="num">{formatArea(row.area)}</td>
                    <td className="num">{row._count?.leads ?? 0}</td>
                    <td>{row.agent ? personName(row.agent.firstName, row.agent.lastName) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={result.data.pagination.page}
            pages={result.data.pagination.pages}
            total={result.data.pagination.total}
            basePath="/properties"
            params={params}
          />
        </>
      )}
    </>
  );
}
