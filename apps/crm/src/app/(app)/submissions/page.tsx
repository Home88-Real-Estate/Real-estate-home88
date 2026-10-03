import type { Metadata } from "next";
import Link from "next/link";
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { markNotificationsRead } from "@/actions/submissions";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import { SUBMISSION_STATUS_CLASS, SUBMISSION_STATUS_LABEL } from "@/lib/labels";
import { CRM_BASE_PATH } from "@/lib/paths";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Αναθέσεις ιδιοκτητών" };

type Row = {
  id: string;
  reference: string;
  kind: string;
  status: string;
  owner: string | null;
  titleEl: string;
  listingType: string;
  propertyType: string;
  city: string | null;
  price: number | null;
  photos: number;
  heldPhotos: number;
  documents: number;
  assignedTo: { id: string; name: string } | null;
  createdAt: string;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SubmissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const sp = await searchParams;
  const q = first(sp.q);
  const status = first(sp.status);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const [result, notes] = await Promise.all([
    apiFetch<{ total: number; data: Row[] }>("/api/submissions", { query: { q, status, page, limit: 25 } }),
    apiFetch<{ unread: number }>("/api/notifications", { query: { unread: 1 } }),
  ]);
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status) params.status = status;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Αναθέσεις ιδιοκτητών</h1>
          <p className="muted">Υποβολές από τον ιστότοπο. Μια υποβολή δεν είναι ακίνητο: ελέγχεται πρώτα από σύμβουλο.</p>
        </div>
        {notes.ok && notes.data.unread > 0 && (
          <form action={markNotificationsRead}>
            <button type="submit" className="btn btn--outline">Σήμανση ειδοποιήσεων ως αναγνωσμένων ({notes.data.unread})</button>
          </form>
        )}
      </div>

      <form className="filters" method="get" action={`${CRM_BASE_PATH}/submissions`}>
        <div className="field">
          <label htmlFor="q">Αναζήτηση</label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="Κωδικός, τίτλος, περιοχή" />
        </div>
        <div className="field">
          <label htmlFor="status">Κατάσταση</label>
          <select id="status" name="status" className="select" defaultValue={status}>
            <option value="">Όλες</option>
            {Object.entries(SUBMISSION_STATUS_LABEL).map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn--outline">Φιλτράρισμα</button>
      </form>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <EmptyState title="Δεν υπάρχουν υποβολές" text="Όταν ένας ιδιοκτήτης υποβάλει ακίνητο από τον ιστότοπο, θα εμφανιστεί εδώ." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th>Ιδιοκτήτης</th>
                  <th>Ακίνητο</th>
                  <th>Τιμή</th>
                  <th>Φωτογραφίες</th>
                  <th>Κατάσταση</th>
                  <th>Σύμβουλος</th>
                  <th>Υποβλήθηκε</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/submissions/${s.id}`} className="mono">{s.reference}</Link></td>
                    <td>{s.owner ?? "—"}{s.kind === "VALUATION" && <span className="muted"> · εκτίμηση</span>}</td>
                    <td>
                      {s.titleEl}
                      <div className="muted">{label(LISTING_TYPE_LABELS, s.listingType, "el")} · {label(PROPERTY_TYPE_LABELS, s.propertyType, "el")}{s.city ? ` · ${s.city}` : ""}</div>
                    </td>
                    <td>{s.price !== null ? formatMoney(s.price) : "—"}</td>
                    <td>
                      {s.photos}
                      {s.heldPhotos > 0 && <span className="badge badge--warn" title="Σε καραντίνα ή απορριφθείσες"> {s.heldPhotos} σε αναμονή</span>}
                      {s.documents > 0 && <span className="muted"> · {s.documents} έγγρ.</span>}
                    </td>
                    <td><span className={SUBMISSION_STATUS_CLASS[s.status] ?? "badge"}>{SUBMISSION_STATUS_LABEL[s.status] ?? s.status}</span></td>
                    <td>{s.assignedTo?.name ?? <span className="muted">Αδιάθετη</span>}</td>
                    <td>{formatDateTime(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={Math.max(1, Math.ceil(result.data.total / 25))} total={result.data.total} basePath="/submissions" params={params} />
        </>
      )}
    </>
  );
}
