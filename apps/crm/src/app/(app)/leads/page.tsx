import Link from "next/link";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, label, type Paginated } from "@home88/types";

import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDateTime, personName } from "@/lib/format";
import { requireRole } from "@/lib/session";

type LeadRow = {
  id: string;
  reference: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  source: string;
  createdAt: string;
  lastContactedAt: string | null;
  property: { id: string; reference: string; titleEl: string } | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
};

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ...Object.keys(LEAD_STATUS_LABELS).map((value) => [value, label(LEAD_STATUS_LABELS, value, "el")]),
];

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("AGENT");
  const sp = await searchParams;

  const q = first(sp.q);
  const status = first(sp.status);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const result = await apiFetch<Paginated<LeadRow>>("/api/leads", {
    query: { q, status, page, limit: 25 },
  });

  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status) params.status = status;

  return (
    <>
      <h1>Leads</h1>

      <form className="filters" method="get" action="/leads">
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="Name, email, reference" />
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
        <div className="empty">No leads match.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Property</th>
                  <th>Assigned</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">
                      <Link href={`/leads/${row.id}`}>{row.reference}</Link>
                    </td>
                    <td>
                      <Link href={`/leads/${row.id}`}>{personName(row.firstName, row.lastName)}</Link>
                      {row.email && <div className="muted" style={{ fontSize: "0.82rem" }}>{row.email}</div>}
                    </td>
                    <td>
                      <StatusBadge value={row.status} kind="lead" />
                    </td>
                    <td>{label(LEAD_SOURCE_LABELS, row.source, "el")}</td>
                    <td>
                      {row.property ? (
                        <Link href={`/properties/${row.property.id}`} className="mono">
                          {row.property.reference}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{row.assignedTo ? personName(row.assignedTo.firstName, row.assignedTo.lastName) : "-"}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={result.data.pagination.page}
            pages={result.data.pagination.pages}
            total={result.data.pagination.total}
            basePath="/leads"
            params={params}
          />
        </>
      )}
    </>
  );
}
