import Link from "next/link";
import { notFound } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata = { title: "Ιστορικό portal" };

type Log = { id: string; runId: string | null; action: string; ok: boolean; errorCode: string | null; detail: string | null; durationMs: number | null; actor: string | null; createdAt: string };

const ACTION: Record<string, string> = { PUBLISH: "Δημοσίευση", UPDATE: "Ενημέρωση", REMOVE: "Απόσυρση", REPUBLISH: "Επαναδημοσίευση", IMPORT_LEADS: "Εισαγωγή leads" };

export default async function PortalHistoryPage({ params }: { params: Promise<{ id: string; code: string }> }) {
  const { id, code } = await params;
  await requireRole("AGENT");
  const result = await apiFetch<{ logs: Log[] }>(`/api/properties/${encodeURIComponent(id)}/portals/${encodeURIComponent(code)}/logs`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  return (
    <>
      <p><Link href={`/properties/${id}`}>‹ Ακίνητο</Link></p>
      <div className="panel">
        <div className="panel__head"><div><h2>Ιστορικό · {code}</h2><p className="panel__sub">Τελευταίες 50 ενέργειες για αυτό το ακίνητο σε αυτό το portal.</p></div></div>
        {result.data.logs.length === 0 ? (
          <div className="empty">Καμία ενέργεια ακόμη.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th scope="col">Ώρα</th><th scope="col">Ενέργεια</th><th scope="col">Αποτέλεσμα</th><th scope="col">Από</th><th scope="col">Λεπτομέρεια</th></tr>
              </thead>
              <tbody>
                {result.data.logs.map((l) => (
                  <tr key={l.id}>
                    <td>{formatDateTime(l.createdAt)}</td>
                    <td>{ACTION[l.action] ?? l.action}</td>
                    <td>{l.ok ? <span className="badge badge--ok">Επιτυχία</span> : <span className="badge badge--danger">Αποτυχία{l.errorCode ? ` · ${l.errorCode}` : ""}</span>}</td>
                    <td>{l.actor ?? "—"}</td>
                    <td>{l.detail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
