import Link from "next/link";
import type { Paginated } from "@home88/types";

import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { formatDateTime, personName } from "@/lib/format";
import { requireRole } from "@/lib/session";
import { CRM_BASE_PATH } from "@/lib/paths";

type ContactRow = {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
  company: string | null;
  roles: string[];
  email: string | null;
  phone: string | null;
  mobile: string | null;
  createdAt: string;
  _count: { leads: number; properties: number };
};

const ROLE_OPTIONS = [
  ["", "Όλοι οι ρόλοι"],
  ["BUYER", "Buyer"],
  ["SELLER", "Seller"],
  ["LANDLORD", "Landlord"],
  ["TENANT", "Tenant"],
  ["OTHER", "Other"],
] as const;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("AGENT");
  const sp = await searchParams;

  const q = first(sp.q);
  const role = first(sp.role);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const result = await apiFetch<Paginated<ContactRow>>("/api/contacts", {
    query: { q, role, page, limit: 25 },
  });

  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (role) params.role = role;

  return (
    <>
      <h1>Επαφές</h1>

      <form className="filters" method="get" action={`${CRM_BASE_PATH}/contacts`}>
        <div className="field">
          <label htmlFor="q">Αναζήτηση</label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="Όνομα, εταιρεία, κωδικός" />
        </div>
        <div className="field">
          <label htmlFor="role">Ρόλος</label>
          <select id="role" name="role" className="select" defaultValue={role}>
            {ROLE_OPTIONS.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn--outline">
          Φιλτράρισμα
        </button>
      </form>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <div className="empty">Καμία επαφή δεν ταιριάζει.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th>Όνομα</th>
                  <th>Εταιρεία</th>
                  <th>Ρόλοι</th>
                  <th>Email</th>
                  <th>Τηλέφωνο</th>
                  <th className="num">Leads</th>
                  <th>Δημιουργία</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">
                      <Link href={`/contacts/${row.id}`}>{row.reference}</Link>
                    </td>
                    <td>
                      <Link href={`/contacts/${row.id}`}>{personName(row.firstName, row.lastName)}</Link>
                    </td>
                    <td>{row.company ?? "-"}</td>
                    <td>{row.roles.join(", ")}</td>
                    <td>{row.email ?? "-"}</td>
                    <td>{row.phone ?? row.mobile ?? "-"}</td>
                    <td className="num">{row._count?.leads ?? 0}</td>
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
            basePath="/contacts"
            params={params}
          />
        </>
      )}
    </>
  );
}
