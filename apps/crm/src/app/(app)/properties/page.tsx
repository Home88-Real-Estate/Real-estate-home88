import type { Metadata } from "next";
import Link from "next/link";
import { can, hasPermission, PERMISSIONS, PROPERTY_CATEGORIES } from "@home88/domain";
import { PROPERTY_STATUS_LABELS, PROPERTY_TYPE_LABELS, label, type Paginated } from "@home88/types";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { PropertyRowActions } from "@/components/PropertyRowActions";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatArea, formatDate, formatMoney, personName } from "@/lib/format";
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
  areaName: string | null;
  neighborhood: string | null;
  floor: number | null;
  yearBuilt: number | null;
  createdAt: string;
  updatedAt: string;
  agentId: string | null;
  createdById: string | null;
  agent: { firstName: string; lastName: string } | null;
  owner: { firstName: string; lastName: string } | null;
  _count: { media: number; leads: number };
  coverThumbnailUrl?: string | null;
  tags?: Array<{ code: string; labelEl: string; color: string }>;
};

const PAGE_SIZE = 50;

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
  DELETED: "Διαγραμμένα",
};

/** The folders offered above the table; the bin is one of them. */
const GROUPS = ["CURRENT", "PUBLIC", "DELETED"];

/** A folder link that keeps every other filter the user has picked. */
function groupHref(group: string, params: Record<string, string>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value || key === "status" || key === "statusGroup") continue;
    next.set(key, value);
  }
  next.set("statusGroup", group);
  const qs = next.toString();
  return qs ? `/properties?${qs}` : "/properties";
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("AGENT");
  const actor = { id: user.id, role: user.role };
  const sp = await searchParams;

  const q = first(sp.q);
  const status = first(sp.status);
  const category = first(sp.category);
  const statusGroup = first(sp.statusGroup);
  const mine = first(sp.mine) === "1" ? "1" : "";
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const result = await apiFetch<Paginated<PropertyRow>>("/api/properties", {
    query: { q, status, category, statusGroup, mine, page, limit: PAGE_SIZE },
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
<h1>{statusGroup === "DELETED" ? "Διαγραμμένα" : "Ακίνητα"}</h1>
          <p className="muted">Παρακάτω θα βρείτε όλα τα καταχωρημένα ακίνητα.</p>
          {result.ok && (
            <p className="muted">
              Αποτελέσματα <strong>{result.data.pagination.total}</strong>
            </p>
          )}
        </div>
        <Link href="/properties/new" className="btn btn--primary">
          + Νέο ακίνητο
        </Link>
      </div>

      <form className="filters" method="get" action={`${CRM_BASE_PATH}/properties`}>
        <div className="field">
          <label htmlFor="q">Αναζήτηση:</label>
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

      <p className="filter-chip-row">
        {GROUPS.map((group) =>
          statusGroup === group ? (
            <span key={group} className="filter-chip">
              {GROUP_LABEL[group]}
            </span>
          ) : (
            <Link key={group} href={groupHref(group, params)} className="filter-chip">
              {GROUP_LABEL[group]}
            </Link>
          ),
        )}
      </p>

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
                  <th className="thumb-col">Εικόνα</th>
                  <th>Ημερ/νία</th>
                  <th className="num">Τιμή</th>
                  <th className="num">Εμβαδόν</th>
<th className="num">Όροφος</th>
                  <th>Περιοχή</th>
                  <th>Υποκατηγορία</th>
                  <th className="num">Έτος Κατασκευής</th>
                  <th>Υπεύθυνος</th>
                  <th>Κατάσταση</th>
                  <th>Ιδιοκτήτης</th>
                  <th>Ενέργειες</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((row) => {
                  const inBin = row.status === "DELETED";
                  const scope = { agentId: row.agentId, createdById: row.createdById };
                  return (
                    <tr key={row.id}>
                      <td className="mono">
                        <Link href={`/properties/${row.id}`}>{row.reference}</Link>
                        {row.tags && row.tags.length > 0 && (
                          <ul className="taglist-inline" aria-label="Ετικέτες">
                            {row.tags.map((t) => (
                              <li key={t.code} className={`tagchip tagchip--${t.color}`}>
                                {t.labelEl}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="thumb-col">
                        <Link href={`/properties/${row.id}`} tabIndex={-1} aria-hidden="true">
                          {row.coverThumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, already a small variant
                            <img src={row.coverThumbnailUrl} alt="" className="thumb" loading="lazy" width={160} height={120} />
                          ) : (
                            <span className="thumb thumb--empty" />
                          )}
                        </Link>
                      </td>
                      <td>{formatDate(row.createdAt)}</td>
                      <td className="num">{formatMoney(row.price)}</td>
                      <td className="num">{formatArea(row.area)}</td>
                      <td className="num">{row.floor ?? "-"}</td>
                      <td>{row.areaName ?? row.neighborhood ?? row.city ?? "-"}</td>
                      <td>{label(PROPERTY_TYPE_LABELS, row.propertyType, "el")}</td>
                      <td className="num">{row.yearBuilt ?? "-"}</td>
                      <td>{row.agent ? personName(row.agent.firstName, row.agent.lastName) : "-"}</td>
                      <td>
                        <StatusBadge value={row.status} kind="property" />
                      </td>
                      <td>{row.owner ? personName(row.owner.firstName, row.owner.lastName) : "-"}</td>
                      <td>
                        <PropertyRowActions
                          id={row.id}
                          canDelete={
                            !inBin && can(actor, PERMISSIONS.PROPERTY_DELETE, scope)
                          }
                          canRestore={
                            inBin && can(actor, PERMISSIONS.PROPERTY_RESTORE, scope)
                          }
                          canPermanentlyDelete={
                            inBin && hasPermission(actor, PERMISSIONS.PROPERTY_DELETE_PERMANENT)
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
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
