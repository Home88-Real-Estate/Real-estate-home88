import type { Metadata } from "next";
import Link from "next/link";
import { MANDATE_STATUS_LABELS, MANDATE_TYPES } from "@home88/domain";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { MANDATE_STATUS_CLASS } from "@/lib/labels";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Ψηφιακές Εντολές" };

type Row = {
  id: string;
  reference: string;
  number: string | null;
  type: string;
  typeLabel: string;
  status: string;
  displayStatus: string;
  property: { id: string; reference: string; titleEl: string } | null;
  principal: string;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const OPEN = ["DRAFT", "ISSUED", "SENT", "VIEWED"];

export default async function MandatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const sp = await searchParams;
  const status = first(sp.status) || "OPEN";
  const type = first(sp.type);
  const scope = first(sp.scope);
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const result = await apiFetch<{ data: Row[]; counts: Record<string, number>; pagination: { page: number; pages: number; total: number } }>("/api/mandates", {
    query: { status: status === "ALL" ? undefined : status, type: type || undefined, scope: scope || undefined, page },
  });
  const counts = result.ok ? result.data.counts : {};
  const countOf = (k: string) => (k === "OPEN" ? OPEN.reduce((s, x) => s + (counts[x] ?? 0), 0) : k === "ALL" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[k] ?? 0);
  const tabs: Array<[string, string]> = [["OPEN", "Σε εξέλιξη"], ["SIGNED", "Υπογεγραμμένες"], ["DRAFT", "Πρόχειρες"], ["CANCELLED", "Ακυρωμένες"], ["ALL", "Όλες"]];
  const qs = (k: string) => `/mandates?status=${k}${type ? `&type=${type}` : ""}${scope ? `&scope=${scope}` : ""}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ψηφιακές Εντολές</h1>
          <p className="muted">Εντολές υπόδειξης και ανάθεσης: έκδοση από εγκεκριμένο κείμενο, υπογραφή και αρχείο.</p>
        </div>
        <Link href="/mandates/new" className="btn btn--primary">Νέα εντολή</Link>
      </div>
      <nav className="tabs" aria-label="Κατάσταση">
        {tabs.map(([k, l]) => (
          <Link key={k} href={qs(k)} className="tabs__link" aria-current={status === k ? "page" : undefined}>{l} <span className="muted">{countOf(k)}</span></Link>
        ))}
      </nav>
      <nav className="row no-print" style={{ marginBottom: 12 }} aria-label="Τύπος">
        <Link href={`/mandates?status=${status}`} className={type ? "btn btn--ghost btn--sm" : "btn btn--outline btn--sm"}>Όλοι οι τύποι</Link>
        {MANDATE_TYPES.map((t) => (
          <Link key={t.value} href={`/mandates?status=${status}&type=${t.value}`} className={type === t.value ? "btn btn--outline btn--sm" : "btn btn--ghost btn--sm"}>{t.label}</Link>
        ))}
      </nav>
      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <EmptyState title="Δεν υπάρχουν εντολές εδώ" text="Δημιουργήστε μια εντολή από έναν ιδιοκτήτη ή ένα ακίνητο." action={{ href: "/mandates/new", label: "Νέα εντολή" }} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Αριθμός</th><th>Τύπος</th><th>Εντολέας</th><th>Ακίνητο</th><th>Διάρκεια</th><th>Κατάσταση</th><th>Ενημέρωση</th></tr>
              </thead>
              <tbody>
                {result.data.data.map((m) => (
                  <tr key={m.id}>
                    <td><Link href={`/mandates/${m.id}`} className="mono">{m.number ?? m.reference}</Link></td>
                    <td>{m.typeLabel}</td>
                    <td>{m.principal || "—"}</td>
                    <td>{m.property ? <><span className="mono">{m.property.reference}</span> · {m.property.titleEl}</> : "—"}</td>
                    <td>{m.startsAt && m.endsAt ? `${formatDate(m.startsAt)} – ${formatDate(m.endsAt)}` : "—"}</td>
                    <td><span className={MANDATE_STATUS_CLASS[m.displayStatus] ?? "badge"}>{MANDATE_STATUS_LABELS[m.displayStatus as keyof typeof MANDATE_STATUS_LABELS] ?? m.displayStatus}</span></td>
                    <td>{formatDate(m.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.data.pagination.page} pages={result.data.pagination.pages} total={result.data.pagination.total} basePath="/mandates" params={{ status, ...(type ? { type } : {}), ...(scope ? { scope } : {}) }} />
        </>
      )}
    </>
  );
}
