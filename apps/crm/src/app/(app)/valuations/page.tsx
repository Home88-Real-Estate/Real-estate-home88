import type { Metadata } from "next";
import Link from "next/link";
import { VALUATION_STATUS_LABELS } from "@home88/domain";
import { PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { formatArea, formatDate, formatMoney } from "@/lib/format";
import { VALUATION_STATUS_CLASS } from "@/lib/labels";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Εκτιμήσεις" };

type Row = {
  id: string;
  reference: string;
  status: string;
  listingType: string;
  propertyType: string;
  areaName: string | null;
  city: string | null;
  area: number | null;
  compCount: number;
  estimate: number | null;
  low: number | null;
  high: number | null;
  recommendedPrice: number | null;
  property: { id: string; reference: string } | null;
  sellerLead: { id: string; reference: string; ownerName: string } | null;
  updatedAt: string;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ValuationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const sp = await searchParams;
  const status = first(sp.status) || "ALL";
  const scope = first(sp.scope);
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const result = await apiFetch<{ data: Row[]; pagination: { page: number; pages: number; total: number } }>("/api/valuations", {
    query: { status: status === "ALL" ? undefined : status, scope: scope || undefined, page },
  });
  const tabs: Array<[string, string]> = [["ALL", "Όλες"], ["DRAFT", "Πρόχειρες"], ["FINAL", "Οριστικές"]];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Εκτιμήσεις</h1>
          <p className="muted">Συγκριτικές εκτιμήσεις αγοράς από συναλλαγές, αγγελίες και εξωτερικές πηγές.</p>
        </div>
        <Link href="/valuations/new" className="btn btn--primary">Νέα εκτίμηση</Link>
      </div>
      <nav className="tabs" aria-label="Είδος">
        <Link href="/valuations" className="tabs__link" aria-current="page">Εκτιμήσεις συμβούλων</Link>
        <Link href="/valuations/requests" className="tabs__link">Από τον ιστότοπο</Link>
      </nav>
      <nav className="tabs tabs--sub" aria-label="Κατάσταση">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/valuations?status=${k}${scope ? `&scope=${scope}` : ""}`} className="tabs__link" aria-current={status === k ? "page" : undefined}>{l}</Link>
        ))}
      </nav>
      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <EmptyState title="Δεν υπάρχουν εκτιμήσεις" text="Ξεκινήστε μια εκτίμηση από ένα ακίνητο ή έναν ιδιοκτήτη." action={{ href: "/valuations/new", label: "Νέα εκτίμηση" }} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th>Ακίνητο</th>
                  <th>Για</th>
                  <th className="num">Συγκριτικά</th>
                  <th className="num">Εύρος</th>
                  <th className="num">Πρόταση</th>
                  <th>Κατάσταση</th>
                  <th>Ενημέρωση</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((v) => (
                  <tr key={v.id}>
                    <td><Link href={`/valuations/${v.id}`} className="mono">{v.reference}</Link></td>
                    <td>{[label(PROPERTY_TYPE_LABELS, v.propertyType, "el"), v.area ? formatArea(v.area) : null, v.areaName ?? v.city].filter(Boolean).join(" · ")}</td>
                    <td>{v.property ? <span className="mono">{v.property.reference}</span> : v.sellerLead ? `${v.sellerLead.ownerName} (${v.sellerLead.reference})` : "—"}</td>
                    <td className="num">{v.compCount}</td>
                    <td className="num">{v.low != null && v.high != null ? `${formatMoney(v.low)} – ${formatMoney(v.high)}` : "—"}</td>
                    <td className="num">{v.recommendedPrice != null ? formatMoney(v.recommendedPrice) : "—"}</td>
                    <td><span className={VALUATION_STATUS_CLASS[v.status] ?? "badge"}>{VALUATION_STATUS_LABELS[v.status] ?? v.status}</span></td>
                    <td>{formatDate(v.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.data.pagination.page} pages={result.data.pagination.pages} total={result.data.pagination.total} basePath="/valuations" params={{ status, ...(scope ? { scope } : {}) }} />
        </>
      )}
    </>
  );
}
