import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { MEDIA_LIFECYCLE_LABEL, MEDIA_SOURCE_LABEL } from "@/lib/labels";
import { CRM_BASE_PATH } from "@/lib/paths";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Πολυμέσα" };

type Row = {
  id: string;
  kind: string;
  fileName: string | null;
  lifecycle: string;
  status: string;
  source: string;
  note: string | null;
  width: number | null;
  height: number | null;
  byteSize: number;
  propertyReference: string | null;
  propertyId: string | null;
  submissionReference: string | null;
  submissionId: string | null;
  isPrimary: boolean;
  createdAt: string;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUS_TEXT: Record<string, string> = { pending_review: "Σε αναμονή ελέγχου", approved: "Εγκεκριμένο", published: "Δημοσιευμένο", rejected: "Απορριφθέν" };

export default async function MediaLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const sp = await searchParams;
  const lifecycle = first(sp.lifecycle);
  const source = first(sp.source);
  const attached = first(sp.attached);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const result = await apiFetch<{ total: number; data: Row[] }>("/api/media", { query: { lifecycle, source, attached, page, limit: 30 } });
  const params: Record<string, string> = {};
  if (lifecycle) params.lifecycle = lifecycle;
  if (source) params.source = source;
  if (attached) params.attached = attached;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Πολυμέσα</h1>
          <p className="muted">Ποια εικόνα ανήκει σε ποιο ακίνητο, αν έχει εγκριθεί και αν είναι δημόσια. Τα ιδιωτικά έγγραφα δεν εμφανίζονται εδώ.</p>
        </div>
      </div>

      <form className="filters" method="get" action={`${CRM_BASE_PATH}/media`}>
        <div className="field">
          <label htmlFor="lifecycle">Κατάσταση αρχείου</label>
          <select id="lifecycle" name="lifecycle" className="select" defaultValue={lifecycle}>
            <option value="">Όλες</option>
            {Object.entries(MEDIA_LIFECYCLE_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="source">Πηγή</label>
          <select id="source" name="source" className="select" defaultValue={source}>
            <option value="">Όλες</option>
            {Object.entries(MEDIA_SOURCE_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="attached">Σύνδεση</label>
          <select id="attached" name="attached" className="select" defaultValue={attached}>
            <option value="">Όλα</option>
            <option value="yes">Σε ακίνητο</option>
            <option value="no">Σε υποβολή (δεν έχει συνδεθεί)</option>
          </select>
        </div>
        <button type="submit" className="btn btn--outline">Φιλτράρισμα</button>
      </form>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <EmptyState title="Δεν βρέθηκαν αρχεία" text="Δεν υπάρχουν πολυμέσα με αυτά τα φίλτρα." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Αρχείο</th><th>Ακίνητο / Υποβολή</th><th>Πηγή</th><th>Αρχείο</th><th>Έλεγχος</th><th>Ποιότητα</th><th>Ανέβηκε</th></tr>
              </thead>
              <tbody>
                {result.data.data.map((m) => (
                  <tr key={m.id}>
                    <td>{m.fileName ?? "—"}{m.isPrimary && <span className="badge badge--info"> Εξώφυλλο</span>}</td>
                    <td>
                      {m.propertyId ? <Link href={`/properties/${m.propertyId}`} className="mono">{m.propertyReference}</Link> : m.submissionId ? <Link href={`/submissions/${m.submissionId}`} className="mono">{m.submissionReference}</Link> : "—"}
                    </td>
                    <td>{MEDIA_SOURCE_LABEL[m.source] ?? m.source}</td>
                    <td>{MEDIA_LIFECYCLE_LABEL[m.lifecycle] ?? m.lifecycle}{m.note && <div className="hint">{m.note}</div>}</td>
                    <td>{STATUS_TEXT[m.status] ?? m.status}</td>
                    <td>{m.width && m.height ? `${m.width}×${m.height}` : "—"}{m.width && m.height && Math.min(m.width, m.height) < 800 && <span className="badge badge--warn"> χαμηλή ανάλυση</span>}</td>
                    <td>{formatDateTime(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={Math.max(1, Math.ceil(result.data.total / 30))} total={result.data.total} basePath="/media" params={params} />
        </>
      )}
    </>
  );
}
