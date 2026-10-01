import Link from "next/link";
import { USER_ROLE_LABELS, USER_STATUS_LABELS, label, type Paginated } from "@home88/types";

import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDateTime, personName } from "@/lib/format";
import { hasRole, requireRole } from "@/lib/session";

type UserRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
};

const ROLE_OPTIONS = [
  ["", "All roles"],
  ...Object.keys(USER_ROLE_LABELS).map((value) => [value, label(USER_ROLE_LABELS, value, "el")]),
];

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ...Object.keys(USER_STATUS_LABELS).map((value) => [value, label(USER_STATUS_LABELS, value, "el")]),
];

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("MANAGER");
  const sp = await searchParams;

  const q = first(sp.q);
  const role = first(sp.role);
  const status = first(sp.status);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const result = await apiFetch<Paginated<UserRow>>("/api/users", {
    query: { q, role, status, page, limit: 25 },
  });

  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (role) params.role = role;
  if (status) params.status = status;

  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>Users</h1>
        {hasRole(user.role, "ADMIN") && (
          <Link href="/users/new" className="btn btn--primary btn--sm">
            New user
          </Link>
        )}
      </div>

      <form className="filters" method="get" action="/users">
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="Name, email, phone" />
        </div>
        <div className="field">
          <label htmlFor="role">Role</label>
          <select id="role" name="role" className="select" defaultValue={role}>
            {ROLE_OPTIONS.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
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
        <div className="empty">No users match.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Phone</th>
                  <th>Last login</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/users/${row.id}`}>{personName(row.firstName, row.lastName)}</Link>
                      <div className="muted" style={{ fontSize: "0.82rem" }}>
                        {row.email}
                      </div>
                    </td>
                    <td>{label(USER_ROLE_LABELS, row.role, "el")}</td>
                    <td>
                      <StatusBadge value={row.status} kind="user" />
                    </td>
                    <td>{row.phone ?? "-"}</td>
                    <td>{formatDateTime(row.lastLoginAt)}</td>
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
            basePath="/users"
            params={params}
          />
        </>
      )}
    </>
  );
}
