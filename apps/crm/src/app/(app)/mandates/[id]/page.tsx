import Link from "next/link";
import { notFound } from "next/navigation";
import { MANDATE_STATUS_LABELS } from "@home88/domain";

import { downloadDocument, duplicateMandate, refreshMandate } from "@/actions/mandates";
import { DocumentUploader } from "@/components/documents/DocumentUploader";
import { CancelForm, EditMandateForm, IssueForm, MandateNoteForm, SendForm } from "@/components/mandates/Forms";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { MANDATE_STATUS_CLASS } from "@/lib/labels";
import { requireRole } from "@/lib/session";

type Party = { id: string; role: string; fullName: string; taxId: string | null; idNumber: string | null; address: string | null; email: string | null; phone: string | null; signedAt: string | null };
type Doc = { id: string; byteSize: number; checksum: string | null } | null;
type Mandate = {
  id: string; reference: string; number: string | null; type: string; typeLabel: string; locale: string; status: string; statusLabel: string; displayStatus: string;
  property: { id: string; reference: string; titleEl: string } | null;
  sellerLead: { id: string; reference: string; ownerName: string } | null;
  agent: { firstName: string; lastName: string } | null;
  startsAt: string | null; endsAt: string | null;
  terms: { price?: number | null; commission?: string | null; viewingDate?: string | null; cadastralCode?: string | null; special?: string | null };
  parties: Party[];
  template: { version: number; checksum: string | null; pending?: boolean } | null;
  text: string | null; renderedChecksum: string | null;
  pdf: Doc; pdfChecksum: string | null; signedDocument: Doc; signedChecksum: string | null;
  signatureMethod: string | null; signatureProvider: string | null; envelopeId: string | null; signingExpiresAt: string | null;
  issuedAt: string | null; sentAt: string | null; viewedAt: string | null; signedAt: string | null; cancelledAt: string | null; cancelReason: string | null;
  events: Array<{ id: string; type: string; summary: string; actorName: string | null; createdAt: string }>;
};
type Readiness = {
  draftProblems: string[]; settingsMissing: string[]; sendMissing: string[]; templateMissing: boolean;
  storageConfigured: boolean; encryptionConfigured: boolean; provider: { state: string; provider: string | null };
};

const STEPS: Array<[string, string]> = [["DRAFT", "Πρόχειρη"], ["ISSUED", "Εκδόθηκε"], ["SENT", "Στάλθηκε"], ["SIGNED", "Υπογράφηκε"]];
const ORDER = ["DRAFT", "ISSUED", "SENT", "VIEWED", "SIGNED"];
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <li className={ok ? "is-done" : undefined}>{children}</li>;
}

export default async function MandatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("AGENT");
  const { id } = await params;
  const result = await apiFetch<{ mandate: Mandate; readiness: Readiness; preview: { text: string; missing: string[]; unknown: string[] } | null }>(`/api/mandates/${encodeURIComponent(id)}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const { mandate: m, readiness: r, preview } = result.data;
  const draft = m.status === "DRAFT";
  const open = ["ISSUED", "SENT", "VIEWED"].includes(m.status);
  const final = ["SIGNED", "DECLINED", "EXPIRED", "CANCELLED"].includes(m.status);
  const ready = draft && !r.templateMissing && r.draftProblems.length === 0 && r.settingsMissing.length === 0 && (preview?.missing.length ?? 1) === 0 && r.storageConfigured && r.encryptionConfigured;
  const providerReady = r.provider.state === "configured" && r.sendMissing.length === 0;
  const idx = ORDER.indexOf(m.status);
  const label = MANDATE_STATUS_LABELS[m.displayStatus as keyof typeof MANDATE_STATUS_LABELS] ?? m.statusLabel;

  return (
    <>
      <div className="between" style={{ marginBottom: 12 }}>
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="mono muted">{m.reference}</span>
            <span className={MANDATE_STATUS_CLASS[m.displayStatus] ?? "badge"}>{label}</span>
            {m.signatureMethod && <span className="badge badge--muted">{m.signatureMethod === "PAPER" ? "Υπογραφή σε χαρτί" : `Ηλεκτρονική υπογραφή · ${m.signatureProvider}`}</span>}
          </div>
          <h1 style={{ margin: 0 }}>{m.typeLabel} {m.number ?? ""}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {m.parties.map((p) => p.fullName).join(", ") || "Χωρίς εντολέα"}
            {m.property && <> · <Link href={`/properties/${m.property.id}`}>{m.property.reference} · {m.property.titleEl}</Link></>}
            {m.sellerLead && <> · <Link href={`/sellers/${m.sellerLead.id}`}>Ιδιοκτήτης {m.sellerLead.reference}</Link></>}
            {m.startsAt && m.endsAt && ` · ${formatDate(m.startsAt)} – ${formatDate(m.endsAt)}`}
          </p>
        </div>
        <div className="row no-print">
          {(final || open) && (
            <form action={duplicateMandate}>
              <input type="hidden" name="id" value={m.id} />
              <button type="submit" className="btn btn--outline btn--sm">Αντίγραφο ως νέα πρόχειρη</button>
            </form>
          )}
        </div>
      </div>

      <div className="trx-grid">
        <div className="trx-main">
          <section className="panel">
            <ol className="pipeline" aria-label="Πρόοδος">
              {STEPS.filter(([k]) => !(k === "SENT" && m.signatureMethod === "PAPER")).map(([k, l], i) => {
                const at = ORDER.indexOf(k);
                return <li key={k} className={m.status === k || (k === "SENT" && m.status === "VIEWED") ? "is-current" : idx > at && i >= 0 && !["CANCELLED", "DECLINED", "EXPIRED"].includes(m.status) ? "is-done" : undefined}>{l}</li>;
              })}
            </ol>

            {draft && (
              <>
                <h2 style={{ marginTop: 0 }}>Πριν την έκδοση</h2>
                <ul className="steps">
                  <Check ok={!r.templateMissing}>
                    Εγκεκριμένο κείμενο {m.template ? `(έκδοση ${m.template.version})` : <>— <Link href="/settings/mandates">προσθέστε το στις Ρυθμίσεις</Link></>}
                  </Check>
                  <Check ok={r.settingsMissing.length === 0}>
                    Αρίθμηση εντολών {r.settingsMissing.length > 0 && <>— λείπουν: {r.settingsMissing.join(", ")} (<Link href="/settings/mandates">Ρυθμίσεις</Link>)</>}
                  </Check>
                  <Check ok={r.draftProblems.length === 0}>Στοιχεία εντολής {r.draftProblems.length > 0 && `— λείπουν: ${r.draftProblems.join(", ")}`}</Check>
                  <Check ok={!!preview && preview.missing.length === 0}>
                    Πεδία κειμένου {preview && preview.missing.length > 0 && `— λείπουν: ${preview.missing.join(", ")}`}
                  </Check>
                  <Check ok={r.storageConfigured && r.encryptionConfigured}>
                    Αποθήκευση και κρυπτογράφηση {!r.storageConfigured && "— δεν έχει ρυθμιστεί η αποθήκευση αρχείων (S3)"} {!r.encryptionConfigured && "— δεν έχει ρυθμιστεί η κρυπτογράφηση"}
                  </Check>
                </ul>
                <IssueForm id={m.id} disabled={!ready} />
              </>
            )}

            {open && (
              <>
                <h2 style={{ marginTop: 0 }}>Υπογραφή</h2>
                {m.status === "ISSUED" && (
                  <SendForm
                    id={m.id}
                    disabled={!providerReady}
                    reason={!providerReady ? (r.provider.state === "configured" ? `Λείπουν ρυθμίσεις: ${r.sendMissing.join(", ")}.` : "Δεν έχει συνδεθεί πάροχος ηλεκτρονικής υπογραφής.") : undefined}
                  />
                )}
                {(m.status === "SENT" || m.status === "VIEWED") && (
                  <form action={refreshMandate} className="row">
                    <input type="hidden" name="id" value={m.id} />
                    <span className="muted">Στάλθηκε {formatDateTime(m.sentAt)}{m.viewedAt && ` · ανοίχτηκε ${formatDateTime(m.viewedAt)}`}{m.signingExpiresAt && ` · ο σύνδεσμος λήγει ${formatDate(m.signingExpiresAt)}`}</span>
                    <button type="submit" className="btn btn--ghost btn--sm">Έλεγχος κατάστασης</button>
                  </form>
                )}
                <details className="subpanel" open={!providerReady}>
                  <summary>Υπογράφηκε σε χαρτί; Ανεβάστε το υπογεγραμμένο αντίγραφο</summary>
                  <DocumentUploader mode="signed-copy" mandateId={m.id} path={`/mandates/${m.id}`} />
                </details>
                <details className="subpanel">
                  <summary>Ακύρωση</summary>
                  <CancelForm id={m.id} />
                </details>
              </>
            )}

            {m.status === "SIGNED" && <p className="notice notice--ok" style={{ margin: 0 }}>Υπογράφηκε {formatDate(m.signedAt)}.{m.displayStatus === "ENDED" ? " Η διάρκειά της έχει λήξει." : ""}</p>}
            {m.status === "CANCELLED" && <p className="notice notice--warn" style={{ margin: 0 }}>Ακυρώθηκε {formatDate(m.cancelledAt)}: {m.cancelReason}</p>}
            {(m.status === "DECLINED" || m.status === "EXPIRED") && <p className="notice notice--warn" style={{ margin: 0 }}>{label}. Για νέα αποστολή δημιουργήστε αντίγραφο.</p>}
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <h2>{draft ? "Προεπισκόπηση κειμένου" : "Κείμενο εντολής"}</h2>
                <p className="panel__sub">
                  {draft
                    ? "Όπως θα εκδοθεί. Τα πεδία σε «» δεν έχουν ακόμη τιμή."
                    : `Πρότυπο έκδοση ${m.template?.version ?? "—"} · SHA-256 κειμένου ${m.renderedChecksum?.slice(0, 16)}…`}
                </p>
              </div>
            </div>
            {draft && r.templateMissing ? (
              <p className="muted">Δεν υπάρχει εγκεκριμένο κείμενο για αυτόν τον τύπο και τη γλώσσα. Το σύστημα δεν γράφει νομικά κείμενα: προσθέστε το κείμενο του δικηγόρου στις <Link href="/settings/mandates">Ρυθμίσεις → Ψηφιακές Εντολές</Link>.</p>
            ) : (
              <pre className="legaltext">{draft ? preview?.text : m.text}</pre>
            )}
            {draft && (
              <details className="subpanel no-print">
                <summary>Επεξεργασία στοιχείων</summary>
                <EditMandateForm
                  id={m.id}
                  d={{ propertyReference: m.property?.reference ?? "", startsAt: m.startsAt, endsAt: m.endsAt, terms: m.terms, parties: m.parties }}
                />
              </details>
            )}
          </section>
        </div>

        <aside className="trx-side">
          <section className="panel">
            <div className="panel__head"><div><h2>Αρχεία</h2></div></div>
            {m.pdf ? (
              <dl className="dl">
                <dt>PDF εντολής</dt>
                <dd>
                  <form action={downloadDocument} className="row">
                    <input type="hidden" name="documentId" value={m.pdf.id} />
                    <button type="submit" className="btn btn--outline btn--sm">Λήψη ({kb(m.pdf.byteSize)})</button>
                  </form>
                  <span className="mono muted" title={m.pdfChecksum ?? ""}>SHA-256 {m.pdfChecksum?.slice(0, 12)}…</span>
                </dd>
                {m.signedDocument && (
                  <>
                    <dt>Υπογεγραμμένο</dt>
                    <dd>
                      <form action={downloadDocument} className="row">
                        <input type="hidden" name="documentId" value={m.signedDocument.id} />
                        <button type="submit" className="btn btn--outline btn--sm">Λήψη ({kb(m.signedDocument.byteSize)})</button>
                      </form>
                      <span className="mono muted" title={m.signedChecksum ?? ""}>SHA-256 {m.signedChecksum?.slice(0, 12)}…</span>
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="muted" style={{ margin: 0 }}>Το PDF δημιουργείται με την έκδοση.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel__head"><div><h2>{m.parties.length > 1 ? "Εντολείς" : "Εντολέας"}</h2></div></div>
            {m.parties.map((p) => (
              <dl key={p.id} className="dl">
                <dt>Όνομα</dt><dd>{p.fullName}{p.signedAt && <span className="badge badge--ok" style={{ marginLeft: 6 }}>υπέγραψε</span>}</dd>
                {p.taxId && <><dt>ΑΦΜ</dt><dd>{p.taxId}</dd></>}
                {p.phone && <><dt>Τηλέφωνο</dt><dd>{p.phone}</dd></>}
                {p.email && <><dt>Email</dt><dd>{p.email}</dd></>}
              </dl>
            ))}
          </section>

          <section className="panel">
            <div className="panel__head"><div><h2>Χρονολόγιο</h2></div></div>
            <MandateNoteForm id={m.id} />
            <ol className="timeline">
              {m.events.map((e) => (
                <li key={e.id}>
                  <span className="timeline__when">{formatDateTime(e.createdAt)}</span>
                  <span>{e.summary}</span>
                  {e.actorName && <span className="muted"> · {e.actorName}</span>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
