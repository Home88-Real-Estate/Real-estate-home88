"use client";

import { useCallback, useEffect, useState } from "react";

import { DocumentUploader } from "@/components/documents/DocumentUploader";
import { Icon } from "@/components/Icon";
import { ActionButton } from "@/components/ui/ActionButton";
import { CRM_BASE_PATH } from "@/lib/paths";

type Item = {
  id: string; kind: string; label: string; status: string; statusLabel: string; note: string | null;
  requestedAt: string | null; reviewedAt: string | null; reviewedBy: string | null; expiresAt: string | null;
  document: { id: string; title: string; mimeType: string; createdAt: string } | null;
};
type Data = {
  items: Item[];
  summary: { total: number; required: number; done: number; verified: number; waiting: number; problems: number };
  suggested: Array<{ kind: string; label: string; level: "usual" | "sometimes" }>;
  kinds: Array<{ kind: string; label: string; category: string }>;
  statuses: Array<{ value: string; label: string; review: boolean }>;
  canEdit: boolean;
  canReview: boolean;
};

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${CRM_BASE_PATH}/api${path}`, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: { accept: "application/json", ...(init?.body === undefined ? {} : { "content-type": "application/json" }) },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new Error(data?.error?.message ?? `Σφάλμα ${res.status}`);
  return data as T;
}

const TONE: Record<string, string> = { VERIFIED: "ok", UPLOADED: "info", IN_REVIEW: "info", REQUESTED: "wait", PENDING: "wait", REJECTED: "bad", EXPIRED: "bad", NOT_REQUIRED: "off" };

/**
 * The property's legal and technical documents as a checklist: what is needed, what was requested, what
 * arrived, and what a manager has checked. Tracking only; it never says a property can be sold.
 */
export function DocumentChecklist({ propertyId }: { propertyId: string }) {
  const base = `/properties/${propertyId}/document-checklist`;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [otherLabel, setOtherLabel] = useState("");
  const [uploadFor, setUploadFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>(base));
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Η λίστα δεν φορτώθηκε.";
      if (/migration/.test(message)) setUnavailable(message);
      else setError(message);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, run: () => Promise<{ items: Item[] } | unknown>) {
    setBusy(key);
    setError(null);
    try {
      await run();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Η αλλαγή δεν αποθηκεύτηκε.");
    } finally {
      setBusy(null);
    }
  }

  async function download(id: string) {
    try {
      const out = await api<{ url: string }>(`/documents/${id}/download`);
      window.open(out.url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Η λήψη απέτυχε.");
    }
  }

  if (unavailable) return <p className="xalert xalert--warn" role="status"><Icon name="info" size={18} /><span>{unavailable}</span></p>;
  if (!data) return <p className="muted" role="status">{error ?? "Φόρτωση…"}</p>;
  const s = data.summary;
  const usual = data.suggested.filter((x) => x.level === "usual");

  return (
    <div className="dchk">
      <div className="dchk__summary" role="status">
        <span className="dchk__pill">{s.done} / {s.required} με έγγραφο</span>
        <span className="dchk__pill dchk__pill--ok">{s.verified} επαληθευμένα</span>
        {s.waiting > 0 && <span className="dchk__pill dchk__pill--wait">{s.waiting} εκκρεμούν</span>}
        {s.problems > 0 && <span className="dchk__pill dchk__pill--bad">{s.problems} με πρόβλημα</span>}
      </div>
      <p className="hint dchk__disclaimer">
        Η λίστα παρακολουθεί έγγραφα· δεν βεβαιώνει ότι το ακίνητο μεταβιβάζεται ή εκμισθώνεται. Τον νομικό και τεχνικό έλεγχο κάνουν δικηγόρος και μηχανικός· «Επαληθεύτηκε» σημαίνει ότι υπεύθυνος του γραφείου είδε το έγγραφο.
      </p>
      {error && <p className="xalert xalert--danger" role="alert"><Icon name="alert" size={18} /><span>{error}</span></p>}

      {data.items.length === 0 ? (
        <div className="dchk__empty">
          <p>Δεν υπάρχει ακόμη λίστα εγγράφων.</p>
          {usual.length > 0 && <p className="hint">Συνήθως χρειάζονται για αυτό το ακίνητο: {usual.map((u) => u.label).join(", ")}.</p>}
        </div>
      ) : (
        <ul className="dchk__list">
          {data.items.map((item) => {
            const reviewLocked = ["VERIFIED", "REJECTED"].includes(item.status) && !data.canReview;
            return (
              <li key={item.id} className={`dchk__item dchk__item--${TONE[item.status] ?? "wait"}`}>
                <div className="dchk__main">
                  <strong>{item.label}</strong>
                  <span className={`dchk__status dchk__status--${TONE[item.status] ?? "wait"}`}>{item.statusLabel}</span>
                </div>
                <div className="dchk__meta">
                  {item.document ? (
                    <button type="button" className="linkbtn" onClick={() => void download(item.document!.id)}><Icon name="file" size={15} /> {item.document.title}</button>
                  ) : (
                    <span className="hint">Χωρίς έγγραφο</span>
                  )}
                  {item.reviewedBy && item.reviewedAt && <span className="hint"> · έλεγχος: {item.reviewedBy}, {new Date(item.reviewedAt).toLocaleDateString("el-GR")}</span>}
                  {item.requestedAt && item.status === "REQUESTED" && <span className="hint"> · ζητήθηκε {new Date(item.requestedAt).toLocaleDateString("el-GR")}</span>}
                  {item.note && <span className="hint"> · {item.note}</span>}
                </div>
                {(data.canEdit || data.canReview) && (
                  <div className="dchk__actions">
                    <label className="sr-only" htmlFor={`st-${item.id}`}>Κατάσταση: {item.label}</label>
                    <select
                      id={`st-${item.id}`}
                      className="select"
                      value={item.status}
                      disabled={busy !== null || reviewLocked}
                      onChange={(e) => void act(item.id, () => api(`${base}/${item.id}`, { method: "PATCH", body: { status: e.target.value } }))}
                    >
                      {data.statuses.map((st) => (
                        <option key={st.value} value={st.value} disabled={(st.review && !data.canReview) || (["UPLOADED", "IN_REVIEW", "VERIFIED"].includes(st.value) && !item.document)}>
                          {st.label}{st.review && !data.canReview ? " (υπεύθυνος)" : ""}
                        </option>
                      ))}
                    </select>
                    {!reviewLocked && data.canEdit && (
                      <ActionButton variant="ghost" size="sm" icon="arrowUp" onClick={() => setUploadFor(uploadFor === item.id ? null : item.id)} aria-expanded={uploadFor === item.id}>
                        {item.document ? "Νέο αρχείο" : "Ανέβασμα"}
                      </ActionButton>
                    )}
                    {!reviewLocked && data.canEdit && (
                      <ActionButton variant="ghost" size="sm" disabled={busy !== null} onClick={() => { if (window.confirm(`Να αφαιρεθεί «${item.label}» από τη λίστα; Το αρχείο μένει στα Έγγραφα.`)) void act(item.id, () => api(`${base}/${item.id}`, { method: "DELETE" })); }}>
                        Αφαίρεση
                      </ActionButton>
                    )}
                  </div>
                )}
                {uploadFor === item.id && (
                  <div className="dchk__upload">
                    <DocumentUploader
                      propertyId={propertyId}
                      propertyChecklistItemId={item.id}
                      defaultTitle={item.label}
                      defaultCategory={data.kinds.find((k) => k.kind === item.kind)?.category ?? "OTHER"}
                      path={`/properties/${propertyId}`}
                      compact
                      onDone={() => { setUploadFor(null); void load(); }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data.canEdit && (
        <div className="dchk__add">
          {usual.length > 0 && (
            <ActionButton variant="secondary" size="sm" icon="check" loading={busy === "suggested"} loadingLabel="Προσθήκη…" onClick={() => void act("suggested", () => api(`${base}/suggested`, { body: {} }))}>
              Προσθήκη των συνήθων ({usual.length})
            </ActionButton>
          )}
          <label className="sr-only" htmlFor={`add-${propertyId}`}>Προσθήκη εγγράφου</label>
          <select id={`add-${propertyId}`} className="select" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Προσθήκη εγγράφου…</option>
            {data.kinds.filter((k) => k.kind === "OTHER" || !data.items.some((i) => i.kind === k.kind)).map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
          {adding === "OTHER" && <input className="input" placeholder="Τίτλος εγγράφου" value={otherLabel} maxLength={200} onChange={(e) => setOtherLabel(e.target.value)} aria-label="Τίτλος εγγράφου" />}
          <ActionButton variant="ghost" size="sm" icon="plus" disabled={!adding || busy !== null || (adding === "OTHER" && !otherLabel.trim())} onClick={() => void act("add", async () => { await api(base, { body: { kind: adding, label: otherLabel.trim() || undefined } }); setAdding(""); setOtherLabel(""); })}>
            Προσθήκη
          </ActionButton>
        </div>
      )}
    </div>
  );
}
