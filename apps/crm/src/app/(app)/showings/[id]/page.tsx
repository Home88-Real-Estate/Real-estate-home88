import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SHOWING_STATUS_LABELS } from "@home88/domain";
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { downloadShowingPdf } from "@/actions/contacts";
import { ReminderForm } from "@/components/contacts/ReminderForm";
import { CancelForm, IssueForm, PrintButton, SendForm } from "@/components/showings/ShowingActions";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, personName } from "@/lib/format";
import { MANDATE_STATUS_CLASS, TASK_PRIORITY_LABEL } from "@/lib/labels";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Υπόδειξη" };

type Issue = { code: string; message: string; field?: string };
type Showing = {
  id: string;
  number: string | null;
  status: string;
  language: string;
  documentDate: string | null;
  visitAt: string | null;
  contact: { id: string; reference: string; firstName: string; lastName: string } | null;
  responsibleUser: { id: string; firstName: string; lastName: string } | null;
  comments: string | null;
  properties: Array<{ id: string; propertyId: string | null; code: string; address: string | null; transactionType: string; propertyType: string | null; area: number | string | null; price: number | string | null }>;
  parties: Array<{ id: string; fullName: string; role: string; signedAt: string | null }>;
  template: { version: number; checksum: string } | null;
  pdfChecksum: string | null;
  storageState: string;
  signature: { method: string | null; provider: string | null; signedAt: string | null; sentAt: string | null; viewedAt: string | null };
  completeness: { status?: string; blockingIssues?: Issue[]; warnings?: Issue[] } | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
};
type Preview = { state: "READY" | "BLOCKED" | "TEMPLATE_UNAVAILABLE" | "TEMPLATE_INVALID"; message: string | null; templateVersion: number | null; text: string | null; textHidden: boolean; blocking: Issue[]; warnings: Issue[] };
type Reminder = { id: string; title: string; status: string; priority: string; dueAt: string | null; showingId: string | null };

export default async function ShowingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("AGENT");
  const { id } = await params;
  const sp = await searchParams;
  const pdfError = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const result = await apiFetch<{ showing: Showing }>(`/api/showings/${encodeURIComponent(id)}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const s = result.data.showing;
  const editable = s.status === "DRAFT" || s.status === "READY_FOR_ISSUANCE";
  const issued = Boolean(s.number);
  const isManager = ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(user.role);

  const [previewRes, eventsRes, remindersRes] = await Promise.all([
    editable ? apiFetch<{ preview: Preview }>(`/api/showings/${encodeURIComponent(id)}/preview`) : Promise.resolve(null),
    apiFetch<{ events: Array<{ id: string; type: string; summary: string; actorName: string | null; createdAt: string }> }>(`/api/showings/${encodeURIComponent(id)}/events`),
    s.contact ? apiFetch<{ data: Reminder[] }>(`/api/contacts/${s.contact.id}/reminders`) : Promise.resolve(null),
  ]);
  const preview = previewRes?.ok ? previewRes.data.preview : null;
  const reminders = remindersRes?.ok ? remindersRes.data.data.filter((r) => r.showingId === s.id) : [];
  const blocking = s.completeness?.blockingIssues ?? [];
  const warnings = s.completeness?.warnings ?? [];
  const agent = s.responsibleUser ? personName(s.responsibleUser.firstName, s.responsibleUser.lastName) : "-";

  return (
    <>
      <div className="page-head no-print">
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className={MANDATE_STATUS_CLASS[s.status] ?? "badge"}>{SHOWING_STATUS_LABELS[s.status as keyof typeof SHOWING_STATUS_LABELS] ?? s.status}</span>
            {s.number && <span className="mono muted">{s.number}</span>}
          </div>
          <h1>Υπόδειξη{s.contact ? ` · ${personName(s.contact.firstName, s.contact.lastName)}` : ""}</h1>
          <p className="muted">{s.visitAt ? formatDateTime(s.visitAt) : "Χωρίς ημερομηνία"} · Διαχειριστής: {agent}</p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {editable && <Link href={`/showings/${s.id}/edit`} className="btn btn--outline">Επεξεργασία</Link>}
          <PrintButton />
          {issued && (
            <form action={downloadShowingPdf}>
              <input type="hidden" name="id" value={s.id} />
              <button type="submit" className="btn btn--outline">Λήψη PDF</button>
            </form>
          )}
          <Link href="/showings" className="btn btn--ghost">Όλες οι υποδείξεις</Link>
        </div>
      </div>
      {pdfError && <div className="notice notice--danger no-print" role="alert">{pdfError}</div>}

      <div className="panel no-print">
        <h2>Στοιχεία</h2>
        <dl className="dl">
          <dt>Πελάτης</dt>
          <dd>{s.contact ? <Link href={`/contacts/${s.contact.id}`}>{personName(s.contact.firstName, s.contact.lastName)} <span className="mono muted">{s.contact.reference}</span></Link> : "-"}</dd>
          <dt>Ημερομηνία και ώρα</dt>
          <dd>{s.visitAt ? formatDateTime(s.visitAt) : "-"}</dd>
          <dt>Διαχειριστής</dt>
          <dd>{agent}</dd>
          <dt>Γλώσσα εγγράφου</dt>
          <dd>{s.language === "en" ? "English" : "Ελληνικά"}</dd>
          <dt>Σχόλια</dt>
          <dd>{s.comments ?? "-"}</dd>
          {s.cancelledAt && (<><dt>Ακυρώθηκε</dt><dd>{formatDate(s.cancelledAt)} · {s.cancelReason}</dd></>)}
        </dl>
      </div>

      <div className="panel no-print">
        <h2>Ακίνητα ({s.properties.length})</h2>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Κωδικός</th><th>Είδος</th><th>Περιοχή / διεύθυνση</th><th className="num">τ.μ.</th><th className="num">Τιμή</th></tr></thead>
            <tbody>
              {s.properties.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.propertyId ? <Link href={`/properties/${p.propertyId}`}>{p.code}</Link> : p.code}</td>
                  <td>{label(PROPERTY_TYPE_LABELS, p.propertyType, "el")} · {label(LISTING_TYPE_LABELS, p.transactionType, "el")}</td>
                  <td>{p.address ?? "-"}</td>
                  <td className="num">{p.area ? Number(p.area) : "-"}</td>
                  <td className="num">{p.price ? formatMoney(p.price) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {issued && <p className="muted small">Τα στοιχεία είναι αυτά που ίσχυαν τη στιγμή της έκδοσης.</p>}
      </div>

      <section className="panel doc-panel" id="document">
        <div className="panel__head no-print"><div><h2>Εντολή Υπόδειξης</h2><p className="panel__sub">Το κείμενο προέρχεται από το εγκεκριμένο πρότυπο (Ρυθμίσεις → Ψηφιακές Εντολές). Δεν αλλάζει από αυτή την οθόνη.</p></div></div>
        {issued ? (
          <div className="stack">
            <dl className="dl">
              <dt>Αριθμός</dt><dd className="mono">{s.number}</dd>
              <dt>Έκδοση</dt><dd>{formatDateTime(s.issuedAt)}{s.template ? ` · πρότυπο v${s.template.version}` : ""}</dd>
              <dt>Υπογραφή</dt><dd>{s.status === "SIGNED" ? `Υπογράφηκε ${formatDate(s.signature.signedAt)}` : s.signature.sentAt ? `Στάλθηκε ${formatDate(s.signature.sentAt)}${s.signature.viewedAt ? " · ανοίχτηκε" : ""}` : "Δεν έχει σταλεί για υπογραφή"}</dd>
              <dt>Αρχείο</dt><dd>{s.storageState === "CONFIRMED" ? "Αποθηκεύτηκε" : "Αποθήκευση σε εξέλιξη"}{s.pdfChecksum ? <span className="mono muted" title={s.pdfChecksum}> · SHA-256 {s.pdfChecksum.slice(0, 12)}…</span> : null}</dd>
            </dl>
            {s.status === "ISSUED" && <SendForm id={s.id} />}
            {isManager && !["SIGNED", "CANCELLED", "EXPIRED", "DECLINED"].includes(s.status) && <CancelForm id={s.id} />}
          </div>
        ) : preview?.state === "READY" && preview.text ? (
          <>
            <div className="notice no-print">Προεπισκόπηση — δεν έχει εκδοθεί. Ο αριθμός δίνεται κατά την έκδοση. Πρότυπο v{preview.templateVersion}.</div>
            <pre className="doc-preview">{preview.text}</pre>
            {preview.warnings.length > 0 && <ul className="no-print">{preview.warnings.map((w) => <li key={w.code} className="muted">{w.message}</li>)}</ul>}
            <div className="row no-print" style={{ gap: 8, flexWrap: "wrap" }}>
              {isManager ? <IssueForm id={s.id} /> : <p className="muted">Την έκδοση την κάνει υπεύθυνος γραφείου.</p>}
            </div>
          </>
        ) : preview?.state === "READY" ? (
          <div className="notice">Το κείμενο περιέχει προσωπικά στοιχεία και εμφανίζεται μόνο σε όσους έχουν δικαίωμα. Η έκδοση παραμένει δυνατή.</div>
        ) : preview?.state === "TEMPLATE_UNAVAILABLE" ? (
          <div className="notice">
            <strong>Δεν υπάρχει εγκεκριμένο πρότυπο.</strong>
            <p style={{ margin: "4px 0 0" }}>{preview.message} Το κείμενο της εντολής ενεργοποιείται μόνο αφού το εγκρίνει ο νομικός σύμβουλος (Ρυθμίσεις → Ψηφιακές Εντολές).</p>
          </div>
        ) : preview?.state === "TEMPLATE_INVALID" ? (
          <div className="notice notice--danger">{preview.message}</div>
        ) : preview?.state === "BLOCKED" ? (
          <div className="notice">Η εντολή υπόδειξης δεν μπορεί να παραχθεί ακόμη: λείπουν στοιχεία (δείτε παρακάτω). Μόλις συμπληρωθούν, εμφανίζεται εδώ η προεπισκόπηση.</div>
        ) : (
          <div className="notice">Η προεπισκόπηση δεν είναι διαθέσιμη.</div>
        )}

        {editable && (blocking.length > 0 || (preview?.state === "BLOCKED" && preview.blocking.length > 0)) && (
          <div className="checklist no-print">
            <h3>Τι λείπει για την έκδοση</h3>
            <ul>
              {(preview?.state === "BLOCKED" ? preview.blocking : blocking).map((i) => <li key={`${i.code}-${i.field ?? ""}`}>{i.message}</li>)}
            </ul>
            <p className="muted small">Συμπληρώστε τα από την επεξεργασία της υπόδειξης και στοιχεία του πελάτη.</p>
          </div>
        )}
        {editable && warnings.length > 0 && <ul className="no-print">{warnings.map((w) => <li key={w.code} className="muted">{w.message}</li>)}</ul>}
      </section>

      <div className="panel no-print">
        <div className="panel__head"><h2>Υπενθυμίσεις</h2></div>
        {reminders.length === 0 ? <p className="muted">Δεν υπάρχουν υπενθυμίσεις για αυτή την υπόδειξη.</p> : (
          <ul className="plain-list">
            {reminders.map((r) => <li key={r.id}>{r.title} <span className="muted">· {r.dueAt ? formatDateTime(r.dueAt) : "χωρίς ημερομηνία"} · {TASK_PRIORITY_LABEL[r.priority] ?? r.priority}{r.status === "DONE" ? " · ολοκληρώθηκε" : ""}</span></li>)}
          </ul>
        )}
        {s.contact && (
          <details className="subpanel">
            <summary>+ Προσθήκη υπενθύμισης</summary>
            <ReminderForm contactId={s.contact.id} showingId={s.id} defaultTitle="Follow-up υπόδειξης" />
          </details>
        )}
      </div>

      <div className="panel no-print">
        <h2>Ιστορικό</h2>
        {eventsRes.ok && eventsRes.data.events.length > 0 ? (
          <ul className="plain-list">
            {eventsRes.data.events.map((e) => <li key={e.id}>{e.summary} <span className="muted">· {formatDateTime(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ""}</span></li>)}
          </ul>
        ) : <p className="muted">Δεν υπάρχουν καταγραφές.</p>}
      </div>
    </>
  );
}
