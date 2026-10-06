import type { Metadata } from "next";
import Link from "next/link";
import { SHOWING_STATUS_LABELS, SHOWING_STATUSES } from "@home88/domain";

import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import type { DirectoryUser } from "@/lib/contacts";
import { formatDate, formatTime } from "@/lib/format";
import { MANDATE_STATUS_CLASS } from "@/lib/labels";
import { CRM_BASE_PATH } from "@/lib/paths";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Υποδείξεις" };

type Row = {
  id: string;
  number: string | null;
  status: string;
  contact: { id: string; reference: string; name: string } | null;
  agent: { id: string; name: string } | null;
  visitAt: string | null;
  comments: string | null;
  clients: string[];
  propertyDetails: Array<{ propertyId: string | null; code: string; address: string | null }>;
  createdAt: string;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ShowingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("AGENT");
  const sp = await searchParams;
  const q = first(sp.q);
  const status = first(sp.status);
  const agentId = first(sp.agentId);
  const from = first(sp.from);
  const to = first(sp.to);
  const scope = first(sp.scope) === "all" ? "all" : "";
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const isManager = ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(user.role);

  const [result, users] = await Promise.all([
    apiFetch<{ data: Row[]; pagination: { page: number; pages: number; total: number } }>("/api/showings", { query: { q, status, agentId, from, to, scope: isManager ? scope || "all" : undefined, page } }),
    apiFetch<{ data: DirectoryUser[] }>("/api/users/directory"),
  ]);
  const hasFilters = Boolean(q || status || agentId || from || to);
  const params: Record<string, string> = Object.fromEntries(Object.entries({ q, status, agentId, from, to }).filter(([, v]) => v));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Υποδείξεις</h1>
          <p className="muted">Ακίνητα που υποδείχθηκαν σε πελάτες, με εκτυπώσιμο και υπογράψιμο έγγραφο από το εγκεκριμένο πρότυπο.</p>
        </div>
        <Link href="/showings/new" className="btn btn--primary">+ Νέα Υπόδειξη</Link>
      </div>

      <form className="panel" method="get" action={`${CRM_BASE_PATH}/showings`}>
        <div className="filters" style={{ marginBottom: 0 }}>
          <div className="field grow">
            <label htmlFor="q">Αναζήτηση</label>
            <input id="q" name="q" className="input" defaultValue={q} placeholder="Πελάτης, αριθμός, κωδικός ή διεύθυνση ακινήτου, διαχειριστής, σχόλια" />
          </div>
          <div className="field">
            <label htmlFor="status">Κατάσταση</label>
            <select id="status" name="status" className="select" defaultValue={status}>
              <option value="">Όλες</option>
              {SHOWING_STATUSES.map((s) => <option key={s} value={s}>{SHOWING_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          {isManager && (
            <div className="field">
              <label htmlFor="agentId">Διαχειριστής</label>
              <select id="agentId" name="agentId" className="select" defaultValue={agentId}>
                <option value="">Όλοι</option>
                {(users.ok ? users.data.data : []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
          <div className="field"><label htmlFor="from">Από</label><input id="from" name="from" type="date" className="input" defaultValue={from} /></div>
          <div className="field"><label htmlFor="to">Έως</label><input id="to" name="to" type="date" className="input" defaultValue={to} /></div>
          <button type="submit" className="btn btn--primary">Φιλτράρισμα</button>
          {hasFilters && <Link href="/showings" className="btn btn--ghost">Καθαρισμός</Link>}
        </div>
      </form>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <div className="empty">{hasFilters ? "Καμία υπόδειξη δεν ταιριάζει." : "Δεν έχουν καταχωρηθεί υποδείξεις ακόμη."}</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data showings-table">
              <thead>
                <tr><th>Πελάτης</th><th>Ημερομηνία</th><th>Ώρα</th><th>Διαχειριστής</th><th>Ακίνητα</th><th>Σχόλια</th><th>Κατάσταση</th><th>Ενέργειες</th></tr>
              </thead>
              <tbody>
                {result.data.data.map((s) => (
                  <tr key={s.id}>
                    <td>{s.contact ? <Link href={`/contacts/${s.contact.id}`}>{s.contact.name}</Link> : s.clients.join(", ") || "-"}{s.number && <div className="mono muted small">{s.number}</div>}</td>
                    <td>{s.visitAt ? formatDate(s.visitAt) : "-"}</td>
                    <td>{s.visitAt ? formatTime(s.visitAt) : "-"}</td>
                    <td>{s.agent?.name ?? "-"}</td>
                    <td>
                      {s.propertyDetails.map((p) => (
                        <div key={p.code}>{p.propertyId ? <Link href={`/properties/${p.propertyId}`} className="mono">{p.code}</Link> : <span className="mono">{p.code}</span>}{p.address && <span className="muted small"> · {p.address}</span>}</div>
                      ))}
                    </td>
                    <td className="clamp">{s.comments ?? "-"}</td>
                    <td><span className={MANDATE_STATUS_CLASS[s.status] ?? "badge"}>{SHOWING_STATUS_LABELS[s.status as keyof typeof SHOWING_STATUS_LABELS] ?? s.status}</span></td>
                    <td className="actions">
                      <Link href={`/showings/${s.id}`} className="btn btn--outline btn--sm">Προβολή</Link>
                      {(s.status === "DRAFT" || s.status === "READY_FOR_ISSUANCE") && <Link href={`/showings/${s.id}/edit`} className="btn btn--ghost btn--sm">Επεξεργασία</Link>}
                      <Link href={`/showings/${s.id}#document`} className="btn btn--ghost btn--sm">{s.number ? "PDF" : "Εκτύπωση"}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.data.pagination.page} pages={result.data.pagination.pages} total={result.data.pagination.total} basePath="/showings" params={params} />
        </>
      )}
    </>
  );
}
