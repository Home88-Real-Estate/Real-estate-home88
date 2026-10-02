import type { Metadata } from "next";
import Link from "next/link";
import { PROPERTY_CATEGORIES } from "@home88/domain";
import { PROPERTY_STATUS_LABELS, label, type Paginated } from "@home88/types";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatArea, formatMoney, personName } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/labels";
import { CRM_BASE_PATH } from "@/lib/paths";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Ακίνητα" };

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

const STATUS_OPTIONS: Array<[string, string]> = [
  ["", "Όλες οι καταστάσεις"],
  ...Object.keys(PROPERTY_STATUS_LABELS).map((value): [string, string] => [
    value,
    label(PROPERTY_STATUS_LABELS, value, "el"),
  ]),
];

const GROUP_LABEL: Record<string, string> = {
  CURRENT: "Χωρίς τα αρχειοθετημένα",
  PUBLIC: "Στην αγορά",
};

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
  const category = first(sp.category);
  const statusGroup = first(sp.statusGroup);
  const mine = first(sp.mine) === "1" ? "1" : "";
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const result = await apiFetch<Paginated<PropertyRow>>("/api/properties", {
    query: { q, status, category, statusGroup, mine, page, limit: 25 },
  });

  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status) params.status = status;
  if (category) params.category = category;
  if (statusGroup) params.statusGroup = statusGroup;
  if (mine) params.mine = mine;
  const filtered = Object.keys(params).length > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ακίνητα</h1>
          <p className="muted">
            {result.ok ? `${result.data.pagination.total} ακίνητα` : "Χαρτοφυλάκιο ακινήτων"}
          </p>
        </div>
        <Link href="/properties/new" className="btn btn--primary">
          + Νέο ακίνητο
        </Link>
      </div>

      <form className="filters" method="get" action={`${CRM_BASE_PATH}/properties`}>
        <div className="field">
          <label htmlFor="q">Αναζήτηση</label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="Κωδικός, τίτλος, πόλη" />
        </div>
        <div className="field">
          <label htmlFor="status">Κατάσταση</label>
          <select id="status" name="status" className="select" defaultValue={status}>
            {STATUS_OPTIONS.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="category">Κατηγορία</label>
          <select id="category" name="category" className="select" defaultValue={category}>
            <option value="">Όλες</option>
            {PROPERTY_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        {statusGroup && <input type="hidden" name="statusGroup" value={statusGroup} />}
        <label className="check filters__check">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine === "1"} />
          Μόνο τα δικά μου
        </label>
        <button type="submit" className="btn btn--outline">
          Φιλτράρισμα
        </button>
        {filtered && (
          <Link href="/properties" className="btn btn--ghost">
            Καθαρισμός
          </Link>
        )}
      </form>

      {statusGroup && GROUP_LABEL[statusGroup] && (
        <p className="filter-chip-row">
          <span className="filter-chip">{GROUP_LABEL[statusGroup]}</span>
        </p>
      )}

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        filtered ? (
          <EmptyState title="Κανένα ακίνητο δεν ταιριάζει" text="Αλλάξτε ή καθαρίστε τα φίλτρα." />
        ) : (
          <EmptyState
            title="Δεν υπάρχουν ακόμη ακίνητα"
            text="Καταχωρίστε το πρώτο ακίνητο για να ξεκινήσει το χαρτοφυλάκιο."
            action={{ href: "/properties/new", label: "+ Νέο ακίνητο" }}
          />
        )
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th>Τίτλος</th>
                  <th>Κατάσταση</th>
                  <th>Περιοχή</th>
                  <th className="num">Τιμή</th>
                  <th className="num">Εμβαδόν</th>
                  <th className="num">Leads</th>
                  <th>Σύμβουλος</th>
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
