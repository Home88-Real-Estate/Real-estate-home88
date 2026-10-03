import type { Metadata } from "next";
import Link from "next/link";
import { COMMISSION_STATUS_LABELS, TRANSACTION_STATUS_LABELS } from "@home88/domain";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { TRX_STATUS_CLASS } from "@/lib/labels";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Συναλλαγές" };

type Row = {
  id: string;
  reference: string;
  type: string;
  status: string;
  property: { id: string; reference: string; titleEl: string };
  agent: { firstName: string; lastName: string } | null;
  buyerName: string;
  agreedAmount: number | null;
  lastOffer: { amount: number; party: string; status: string } | null;
  commission: { gross: number; status: string } | null;
  updatedAt: string;
};


const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const sp = await searchParams;
  const status = first(sp.status) || "OPEN";
  const scope = first(sp.scope);
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const result = await apiFetch<{ data: Row[]; counts: Record<string, number>; scope: string; pagination: { page: number; pages: number; total: number } }>(
    "/api/transactions",
    { query: { status: status === "ALL" ? undefined : status, scope: scope || undefined, page } },
  );
  const tabs: Array<[string, string]> = [["OPEN", "Ανοιχτές"], ...Object.entries(TRANSACTION_STATUS_LABELS), ["ALL", "Όλες"]];
  const counts = result.ok ? result.data.counts : {};
  const countOf = (k: string) => (k === "OPEN" ? (counts.NEGOTIATION ?? 0) + (counts.AGREEMENT ?? 0) + (counts.CONTRACT ?? 0) : k === "ALL" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[k] ?? 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Συναλλαγές</h1>
          <p className="muted">Από την πρώτη προσφορά μέχρι το κλείσιμο και την προμήθεια.</p>
        </div>
        <Link href="/transactions/new" className="btn btn--primary">Νέα συναλλαγή</Link>
      </div>
      <nav className="tabs" aria-label="Κατάσταση">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/transactions?status=${k}${scope ? `&scope=${scope}` : ""}`} className="tabs__link" aria-current={status === k ? "page" : undefined}>
            {l} <span className="muted">{countOf(k)}</span>
          </Link>
        ))}
      </nav>
      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <EmptyState title="Δεν υπάρχουν συναλλαγές" text="Ξεκινήστε μια συναλλαγή όταν ένας πελάτης κάνει προσφορά σε ακίνητο." action={{ href: "/transactions/new", label: "Νέα συναλλαγή" }} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th>Ακίνητο</th>
                  <th>Αγοραστής / μισθωτής</th>
                  <th className="num">Τελευταία προσφορά</th>
                  <th className="num">Συμφωνία</th>
                  <th>Προμήθεια</th>
                  <th>Κατάσταση</th>
                  <th>Ενημέρωση</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((t) => (
                  <tr key={t.id}>
                    <td><Link href={`/transactions/${t.id}`} className="mono">{t.reference}</Link></td>
                    <td><span className="mono">{t.property.reference}</span> · {t.property.titleEl}</td>
                    <td>{t.buyerName}</td>
                    <td className="num">{t.lastOffer ? formatMoney(t.lastOffer.amount) : "—"}</td>
                    <td className="num">{t.agreedAmount != null ? formatMoney(t.agreedAmount) : "—"}</td>
                    <td>{t.commission ? `${formatMoney(t.commission.gross)} · ${COMMISSION_STATUS_LABELS[t.commission.status] ?? t.commission.status}` : "—"}</td>
                    <td><span className={TRX_STATUS_CLASS[t.status] ?? "badge"}>{TRANSACTION_STATUS_LABELS[t.status as keyof typeof TRANSACTION_STATUS_LABELS] ?? t.status}</span></td>
                    <td>{formatDate(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.data.pagination.page} pages={result.data.pagination.pages} total={result.data.pagination.total} basePath="/transactions" params={{ status, ...(scope ? { scope } : {}) }} />
        </>
      )}
    </>
  );
}
