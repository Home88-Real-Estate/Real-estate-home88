import type { Metadata } from "next";
import Link from "next/link";
import { PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { formatArea, formatDate, formatMoney } from "@/lib/format";
import { CONFIDENCE_LABEL, REQUEST_STAGE_LABELS } from "@/lib/valuation-requests";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Εκτιμήσεις από τον ιστότοπο" };

type Row = {
  id: string;
  reference: string;
  status: string;
  stage: string;
  propertyType: string;
  city: string | null;
  areaName: string | null;
  areaSqm: number | null;
  estimatedMin: number | null;
  estimatedMax: number | null;
  confidence: string | null;
  comparableCount: number;
  client: string | null;
  lead: string | null;
  agent: string | null;
  createdAt: string;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ValuationRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const sp = await searchParams;
  const stage = first(sp.stage) || "ALL";
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const result = await apiFetch<{ data: Row[]; pagination: { page: number; pages: number; total: number } }>("/api/valuation-requests", {
    query: { stage: stage === "ALL" ? undefined : stage, page },
  });
  const tabs: Array<[string, string]> = [["ALL", "Όλες"], ...Object.entries(REQUEST_STAGE_LABELS)];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Εκτιμήσεις</h1>
          <p className="muted">Αυτόματες ενδεικτικές εκτιμήσεις που ζητήθηκαν από τον ιστότοπο, με τα συγκρίσιμα που χρησιμοποιήθηκαν.</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Είδος">
        <Link href="/valuations" className="tabs__link">Εκτιμήσεις συμβούλων</Link>
        <Link href="/valuations/requests" className="tabs__link" aria-current="page">Από τον ιστότοπο</Link>
      </nav>
      <nav className="tabs tabs--sub" aria-label="Στάδιο">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/valuations/requests?stage=${k}`} className="tabs__link" aria-current={stage === k ? "page" : undefined}>{l}</Link>
        ))}
      </nav>
      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <EmptyState title="Δεν υπάρχουν αιτήματα" text="Οι εκτιμήσεις που κάνουν οι επισκέπτες στον ιστότοπο εμφανίζονται εδώ." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th>Πελάτης</th>
                  <th>Ακίνητο</th>
                  <th className="num">Ενδεικτικό εύρος</th>
                  <th>Αξιοπιστία</th>
                  <th className="num">Συγκριτικά</th>
                  <th>Στάδιο</th>
                  <th>Σύμβουλος</th>
                  <th>Ημερομηνία</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/valuations/requests/${r.id}`} className="mono">{r.reference}</Link></td>
                    <td>{r.client ? `${r.client}${r.lead ? ` (${r.lead})` : ""}` : <span className="muted">Χωρίς στοιχεία</span>}</td>
                    <td>{[label(PROPERTY_TYPE_LABELS, r.propertyType, "el"), r.areaSqm ? formatArea(r.areaSqm) : null, r.areaName ?? r.city].filter(Boolean).join(" · ")}</td>
                    <td className="num">{r.estimatedMin != null && r.estimatedMax != null ? `${formatMoney(r.estimatedMin)} – ${formatMoney(r.estimatedMax)}` : <span className="muted">Ανεπαρκή στοιχεία</span>}</td>
                    <td>{r.confidence ? CONFIDENCE_LABEL[r.confidence] : "—"}</td>
                    <td className="num">{r.comparableCount}</td>
                    <td><span className="badge">{REQUEST_STAGE_LABELS[r.stage] ?? r.stage}</span></td>
                    <td>{r.agent ?? <span className="muted">—</span>}</td>
                    <td>{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.data.pagination.page} pages={result.data.pagination.pages} total={result.data.pagination.total} basePath="/valuations/requests" params={{ stage }} />
        </>
      )}
    </>
  );
}
