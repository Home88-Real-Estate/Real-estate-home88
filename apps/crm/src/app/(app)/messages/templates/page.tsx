import type { Metadata } from "next";
import Link from "next/link";
import { MESSAGE_MERGE_FIELDS } from "@home88/domain";

import { toggleTemplate } from "@/actions/messages";
import { TemplateForm } from "@/components/messages/TemplateForm";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Πρότυπα μηνυμάτων" };

type T = { id: string; name: string; channel: string; purpose: string; subject: string | null; body: string; active: boolean; updatedAt: string };

export default async function TemplatesPage() {
  await requireRole("AGENT");
  const result = await apiFetch<{ data: T[]; canManage: boolean }>("/api/message-templates", { query: { all: 1 } });
  if (!result.ok) return <div className="notice notice--danger">{result.error.message}</div>;
  const { data, canManage } = result.data;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Πρότυπα μηνυμάτων</h1>
          <p className="muted">Τα κείμενα τα γράφει το γραφείο· το σύστημα δεν έχει έτοιμα κείμενα. Τα πεδία σε {"{{ }}"} συμπληρώνονται κατά την αποστολή.</p>
        </div>
        <Link href="/messages" className="btn btn--outline btn--sm">Επιστροφή</Link>
      </div>
      {canManage && (
        <details className="subpanel panel" open={data.length === 0}>
          <summary>Νέο πρότυπο</summary>
          <TemplateForm />
        </details>
      )}
      {data.length === 0 ? (
        <p className="muted">Δεν υπάρχουν πρότυπα ακόμη.</p>
      ) : (
        data.map((t) => (
          <section key={t.id} className="panel">
            <div className="panel__head">
              <div>
                <h2>{t.name}</h2>
                <p className="panel__sub">{t.channel === "EMAIL" ? "Email" : "SMS"} · {t.purpose === "MARKETING" ? "Προώθηση" : "Εξυπηρέτηση"} · ενημέρωση {formatDate(t.updatedAt)}</p>
              </div>
              <div className="row">
                {!t.active && <span className="badge badge--muted">Ανενεργό</span>}
                {canManage && (
                  <form action={toggleTemplate}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="active" value={t.active ? "false" : "true"} />
                    <button type="submit" className="btn btn--ghost btn--sm">{t.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</button>
                  </form>
                )}
              </div>
            </div>
            {canManage ? (
              <details className="subpanel">
                <summary>Επεξεργασία</summary>
                <TemplateForm t={t} />
              </details>
            ) : (
              <>
                {t.subject && <strong>{t.subject}</strong>}
                <pre className="msg__body">{t.body}</pre>
              </>
            )}
          </section>
        ))
      )}
      <details className="subpanel panel">
        <summary>Πεδία που συμπληρώνονται αυτόματα</summary>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th className="nocase">Πεδίο</th><th>Τι συμπληρώνεται</th></tr></thead>
            <tbody>{MESSAGE_MERGE_FIELDS.map((f) => <tr key={f.key}><td className="mono">{`{{${f.key}}}`}</td><td>{f.label}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </>
  );
}
