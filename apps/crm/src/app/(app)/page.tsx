import Link from "next/link";
import type { Paginated } from "@home88/types";

import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatArea, formatMoney } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { displayName } from "@/lib/user";

type PropertyRow = {
  id: string;
  reference: string;
  titleEl: string;
  status: string;
  price: unknown;
  area: unknown;
};

export default async function DashboardPage() {
  const user = await requireUser();

  const [properties, leads, contacts, recent] = await Promise.all([
    apiFetch<Paginated<PropertyRow>>("/api/properties", { query: { limit: 1 } }),
    apiFetch<Paginated<unknown>>("/api/leads", { query: { limit: 1 } }),
    apiFetch<Paginated<unknown>>("/api/contacts", { query: { limit: 1 } }),
    apiFetch<Paginated<PropertyRow>>("/api/properties", { query: { limit: 6 } }),
  ]);

  const apiDown = !properties.ok && properties.status === 0;

  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <div>
          <h1>Dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>
            Welcome back, {displayName(user)}.
          </p>
        </div>
        <Link href="/properties/new" className="btn btn--primary">
          New property
        </Link>
      </div>

      {apiDown && (
        <div className="notice notice--danger" style={{ marginBottom: 18 }}>
          The API is unreachable. Start it with{" "}
          <span className="mono">npm run dev -w @home88/api</span> and reload.
        </div>
      )}

      <div className="stat-grid">
        <Stat label="Properties" value={properties.ok ? properties.data.pagination.total : null} href="/properties" />
        <Stat label="Leads" value={leads.ok ? leads.data.pagination.total : null} href="/leads" />
        <Stat label="Contacts" value={contacts.ok ? contacts.data.pagination.total : null} href="/contacts" />
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel__head">
          <h2 style={{ margin: 0 }}>Recently updated</h2>
          <Link href="/properties" className="btn btn--outline btn--sm">
            View all
          </Link>
        </div>

        {recent.ok && recent.data.data.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th className="num">Price</th>
                  <th className="num">Area</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.data.map((row) => (
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
                    <td className="num">{formatMoney(row.price)}</td>
                    <td className="num">{formatArea(row.area)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">No properties yet. Create the first one.</div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: number | null; href: string }) {
  return (
    <Link href={href} className="stat">
      <div className="label">{label}</div>
      <div className="value">{value ?? "-"}</div>
    </Link>
  );
}
