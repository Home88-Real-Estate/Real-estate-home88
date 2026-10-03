import type { Metadata } from "next";
import Link from "next/link";
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS, label, type Paginated } from "@home88/types";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { REQUEST_STATUS_CLASS, REQUEST_STATUS_LABEL, priceRange } from "@/lib/labels";
import { CRM_BASE_PATH } from "@/lib/paths";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Ζητήσεις" };

export type RequestRow = {
  id: string;
  reference: string;
  status: string;
  listingType: string;
  propertyTypes: string[];
  areas: string[];
  minPrice: string | null;
  maxPrice: string | null;
  minArea: string | null;
  minBedrooms: number | null;
  clientName: string;
  clientPhone: string | null;
  rating: number | null;
  createdAt: string;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("AGENT");
  const sp = await searchParams;
  const q = first(sp.q);
  const status = first(sp.status) || "ACTIVE";
  const listingType = first(sp.listingType);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const result = await apiFetch<Paginated<RequestRow>>("/api/requests", {
    query: { q, status: status === "ALL" ? undefined : status, listingType, page, limit: 25 },
  });
  const params: Record<string, string> = { status };
  if (q) params.q = q;
  if (listingType) params.listingType = listingType;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ζητήσεις</h1>
          <p className="muted">Τι ψάχνουν οι πελάτες, με αυτόματη αντιστοίχιση σε ακίνητα.</p>
        </div>
        <Link href="/requests/new" className="btn btn--primary">
          Νέα ζήτηση
        </Link>
      </div>

      <form className="filters" method="get" action={`${CRM_BASE_PATH}/requests`}>
        <div className="field">
          <label htmlFor="q">Αναζήτηση</label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="Πελάτης, τηλέφωνο, κωδικός" />
        </div>
        <div className="field">
          <label htmlFor="status">Κατάσταση</label>
          <select id="status" name="status" className="select" defaultValue={status}>
            {Object.entries(REQUEST_STATUS_LABEL).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
            <option value="ALL">Όλες</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="listingType">Για</label>
          <select id="listingType" name="listingType" className="select" defaultValue={listingType}>
            <option value="">Όλα</option>
            {Object.keys(LISTING_TYPE_LABELS).map((key) => (
              <option key={key} value={key}>
                {label(LISTING_TYPE_LABELS, key, "el")}
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
        <EmptyState
          title="Δεν υπάρχουν ζητήσεις"
          text="Καταχωρίστε τι ψάχνει ένας πελάτης και το CRM θα βρει τα ακίνητα που του ταιριάζουν."
          action={{ href: "/requests/new", label: "Νέα ζήτηση" }}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th>Πελάτης</th>
                  <th>Ζητά</th>
                  <th>Περιοχές</th>
                  <th>Τιμή</th>
                  <th>Κατάσταση</th>
                  <th>Καταχώριση</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/requests/${r.id}`} className="mono">
                        {r.reference}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/requests/${r.id}`}>{r.clientName}</Link>
                      {r.rating ? <span className="muted"> {"★".repeat(r.rating)}</span> : null}
                    </td>
                    <td>
                      {label(LISTING_TYPE_LABELS, r.listingType, "el")}
                      {r.propertyTypes.length > 0 && (
                        <span className="muted"> · {r.propertyTypes.map((t) => label(PROPERTY_TYPE_LABELS, t, "el")).join(", ")}</span>
                      )}
                    </td>
                    <td>{r.areas.join(", ") || "—"}</td>
                    <td>{priceRange(r.minPrice, r.maxPrice)}</td>
                    <td>
                      <span className={REQUEST_STATUS_CLASS[r.status] ?? "badge"}>{REQUEST_STATUS_LABEL[r.status] ?? r.status}</span>
                    </td>
                    <td>{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination basePath="/requests" params={params} page={result.data.pagination.page} pages={result.data.pagination.pages} total={result.data.pagination.total} />
        </>
      )}
    </>
  );
}
