import type { Metadata } from "next";
import Link from "next/link";
import { MESSAGE_STATUS_LABELS } from "@home88/domain";

import { EmptyState } from "@/components/EmptyState";
import { MESSAGE_STATUS_CLASS } from "@/components/messages/ContactCommunication";
import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { hasRole, requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Επικοινωνία" };

type Row = { id: string; channel: string; purpose: string; status: string; to: string | null; subject: string | null; body: string | null; error: string | null; contact: { id: string; reference: string; name: string } | null; template: string | null; sentBy: string | null; createdAt: string };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("AGENT");
  const sp = await searchParams;
  const status = first(sp.status);
  const channel = first(sp.channel);
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const result = await apiFetch<{ data: Row[]; pagination: { page: number; pages: number; total: number } }>("/api/messages", {
    query: { status: status || undefined, channel: channel || undefined, page },
  });
  const manager = hasRole(user.role, "MANAGER");
  const tabs: Array<[string, string]> = [["", "Όλα"], ["SENT", "Στάλθηκαν"], ["LOGGED", "Χωρίς πάροχο"], ["FAILED", "Απέτυχαν"], ["BLOCKED", "Δεν επιτράπηκαν"]];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Επικοινωνία</h1>
          <p className="muted">{manager ? "Όλα τα μηνύματα προς πελάτες." : "Τα μηνύματα που στείλατε."} Νέο μήνυμα στέλνεται από τη σελίδα της επαφής.</p>
        </div>
        <Link href="/messages/templates" className="btn btn--outline">Πρότυπα μηνυμάτων</Link>
      </div>
      <nav className="tabs" aria-label="Κατάσταση">
        {tabs.map(([k, l]) => (
          <Link key={k || "all"} href={`/messages${k ? `?status=${k}` : ""}`} className="tabs__link" aria-current={status === k ? "page" : undefined}>{l}</Link>
        ))}
      </nav>
      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <EmptyState title="Δεν υπάρχουν μηνύματα" text="Ανοίξτε μια επαφή για να στείλετε email ή SMS." action={{ href: "/contacts", label: "Επαφές" }} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Ημερομηνία</th><th>Προς</th><th>Κανάλι</th><th>Θέμα / κείμενο</th><th>Κατάσταση</th><th>Από</th></tr></thead>
              <tbody>
                {result.data.data.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDateTime(m.createdAt)}</td>
                    <td>{m.contact ? <Link href={`/contacts/${m.contact.id}#communication`}>{m.contact.name}</Link> : "—"}</td>
                    <td>{m.channel === "EMAIL" ? "Email" : "SMS"}{m.purpose === "MARKETING" ? " · προώθηση" : ""}</td>
                    <td>{m.subject ?? (m.body ? `${m.body.slice(0, 80)}${m.body.length > 80 ? "…" : ""}` : "—")}{m.error && <><br /><span className="error">{m.error}</span></>}</td>
                    <td><span className={MESSAGE_STATUS_CLASS[m.status] ?? "badge"}>{MESSAGE_STATUS_LABELS[m.status] ?? m.status}</span></td>
                    <td>{m.sentBy ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.data.pagination.page} pages={result.data.pagination.pages} total={result.data.pagination.total} basePath="/messages" params={{ ...(status ? { status } : {}), ...(channel ? { channel } : {}) }} />
        </>
      )}
    </>
  );
}
