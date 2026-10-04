import type { Metadata } from "next";
import Link from "next/link";
import { DOCUMENT_CATEGORY_LABELS } from "@home88/domain";

import { deleteDocument, downloadDocument } from "@/actions/mandates";
import { DocumentUploader } from "@/components/documents/DocumentUploader";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Έγγραφα" };

type Row = {
  id: string;
  title: string;
  category: string;
  categoryLabel: string;
  mimeType: string;
  byteSize: number;
  checksum: string | null;
  containsPersonalData: boolean;
  property: { id: string; reference: string } | null;
  contact: { id: string; reference: string; name: string } | null;
  transaction: { id: string; reference: string } | null;
  mandate: { id: string; reference: string } | null;
  locked: boolean;
  createdAt: string;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const TYPE: Record<string, string> = { "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const sp = await searchParams;
  const category = first(sp.category);
  const q = first(sp.q);
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const result = await apiFetch<{ data: Row[]; canDelete: boolean; storageConfigured: boolean; pagination: { page: number; pages: number; total: number } }>("/api/documents", {
    query: { category: category || undefined, q: q || undefined, page },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Έγγραφα</h1>
          <p className="muted">Ιδιωτικά αρχεία: ανοίγουν μόνο με σύνδεσμο λίγων λεπτών και κάθε λήψη καταγράφεται.</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Κατηγορία">
        <Link href="/documents" className="tabs__link" aria-current={!category ? "page" : undefined}>Όλα</Link>
        {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, l]) => (
          <Link key={k} href={`/documents?category=${k}`} className="tabs__link" aria-current={category === k ? "page" : undefined}>{l}</Link>
        ))}
      </nav>
      {result.ok && !result.data.storageConfigured && <div className="notice notice--warn">Η αποθήκευση αρχείων (S3) δεν έχει ρυθμιστεί στον server· δεν μπορούν να ανέβουν έγγραφα.</div>}
      {result.ok && result.data.storageConfigured && (
        <details className="subpanel panel no-print">
          <summary>Ανέβασμα εγγράφου</summary>
          <DocumentUploader path="/documents" />
          <p className="hint">Για έγγραφα συναλλαγής ανεβάστε τα από τη λίστα εγγράφων της συναλλαγής, ώστε να συνδεθούν με αυτήν.</p>
        </details>
      )}
      <form className="row no-print" style={{ margin: "12px 0" }}>
        {category && <input type="hidden" name="category" value={category} />}
        <input name="q" defaultValue={q} className="input input--sm" placeholder="Τίτλος" aria-label="Αναζήτηση" />
        <button type="submit" className="btn btn--outline btn--sm">Αναζήτηση</button>
      </form>
      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <EmptyState title="Δεν υπάρχουν έγγραφα" text="Τα έγγραφα συναλλαγών και οι εντολές εμφανίζονται εδώ." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Τίτλος</th><th>Κατηγορία</th><th>Συνδέεται με</th><th className="num">Μέγεθος</th><th>Ημερομηνία</th><th /></tr>
              </thead>
              <tbody>
                {result.data.data.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.title} <span className="muted">· {TYPE[d.mimeType] ?? "DOCX"}</span>
                      {d.containsPersonalData && <span className="badge badge--warn" style={{ marginLeft: 6 }}>Προσωπικά δεδομένα</span>}
                    </td>
                    <td>{d.categoryLabel}</td>
                    <td>
                      {[
                        d.mandate && <Link key="m" href={`/mandates/${d.mandate.id}`} className="mono">{d.mandate.reference}</Link>,
                        d.transaction && <Link key="t" href={`/transactions/${d.transaction.id}`} className="mono">{d.transaction.reference}</Link>,
                        d.property && <Link key="p" href={`/properties/${d.property.id}`} className="mono">{d.property.reference}</Link>,
                        d.contact && <Link key="c" href={`/contacts/${d.contact.id}`}>{d.contact.name}</Link>,
                      ].filter(Boolean).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, " · ", el] : [el]), [])}
                    </td>
                    <td className="num">{size(d.byteSize)}</td>
                    <td>{formatDate(d.createdAt)}</td>
                    <td>
                      <div className="row">
                        <form action={downloadDocument}>
                          <input type="hidden" name="documentId" value={d.id} />
                          <button type="submit" className="btn btn--ghost btn--sm">Λήψη</button>
                        </form>
                        {result.data.canDelete && !d.locked && (
                          <form action={deleteDocument}>
                            <input type="hidden" name="documentId" value={d.id} />
                            <button type="submit" className="btn btn--ghost btn--sm" aria-label={`Διαγραφή ${d.title}`}>Διαγραφή</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.data.pagination.page} pages={result.data.pagination.pages} total={result.data.pagination.total} basePath="/documents" params={{ ...(category ? { category } : {}), ...(q ? { q } : {}) }} />
        </>
      )}
    </>
  );
}
