"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { DOCUMENT_CATEGORY_LABELS } from "@home88/domain";

import { revalidateAfterUpload } from "@/actions/mandates";
import { CRM_BASE_PATH } from "@/lib/paths";

const TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${CRM_BASE_PATH}/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(data?.error?.message ?? `Σφάλμα ${response.status}`);
  return data as T;
}

type Props = {
  /** "document" registers a document; "signed-copy" records a mandate's signed copy. */
  mode?: "document" | "signed-copy";
  mandateId?: string;
  propertyId?: string;
  contactId?: string;
  transactionId?: string;
  checklistItemId?: string;
  /** A property's document checklist entry this file answers. */
  propertyChecklistItemId?: string;
  /** Called after a successful upload (for screens that reload their own data). */
  onDone?: () => void;
  defaultTitle?: string;
  defaultCategory?: string;
  /** Page to refresh afterwards. */
  path: string;
  compact?: boolean;
};

export function DocumentUploader({ mode = "document", mandateId, propertyId, contactId, transactionId, checklistItemId, propertyChecklistItemId, onDone, defaultTitle, defaultCategory = "OTHER", path, compact }: Props) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setMessage({ ok: false, text: "Επιλέξτε αρχείο." });
    if (!TYPES[file.type]) return setMessage({ ok: false, text: "Επιτρέπονται PDF, JPG, PNG και DOCX." });
    setBusy(true);
    setMessage(null);
    try {
      const ticket = await postJson<{ token: string; upload: { url: string; headers: Record<string, string> } }>("/documents/uploads", {
        fileName: file.name,
        mimeType: file.type,
        byteSize: file.size,
      });
      const put = await fetch(ticket.upload.url, { method: "PUT", headers: ticket.upload.headers, body: file });
      if (!put.ok) throw new Error(`Η αποθήκευση απάντησε ${put.status}`);
      if (mode === "signed-copy" && mandateId) {
        await postJson(`/mandates/${encodeURIComponent(mandateId)}/signed-copy`, { token: ticket.token, signedAt: String(fd.get("signedAt") ?? "") });
      } else {
        await postJson("/documents", {
          token: ticket.token,
          title: String(fd.get("title") ?? "") || file.name,
          category: String(fd.get("category") ?? defaultCategory),
          containsPersonalData: fd.get("personal") === "on",
          propertyId: propertyId ?? "",
          contactId: contactId ?? "",
          transactionId: transactionId ?? "",
          checklistItemId: checklistItemId ?? "",
          propertyChecklistItemId: propertyChecklistItemId ?? "",
        });
      }
      form.reset();
      setMessage({ ok: true, text: mode === "signed-copy" ? "Η εντολή καταχωρίστηκε ως υπογεγραμμένη." : "Το έγγραφο ανέβηκε." });
      await revalidateAfterUpload(path);
      router.refresh();
      onDone?.();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Η μεταφόρτωση απέτυχε." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={compact ? "upload upload--compact" : "formgrid upload"}>
      <div className="field">
        <label htmlFor={`${uid}-file`}>{mode === "signed-copy" ? "Υπογεγραμμένο αντίγραφο (σκαναρισμένο)" : "Αρχείο"}</label>
        <input id={`${uid}-file`} name="file" type="file" accept={Object.keys(TYPES).join(",")} required className="input" />
      </div>
      {mode === "signed-copy" ? (
        <div className="field">
          <label htmlFor={`${uid}-date`}>Ημερομηνία υπογραφής</label>
          <input id={`${uid}-date`} name="signedAt" type="date" className="input" required max={new Date().toISOString().slice(0, 10)} />
        </div>
      ) : (
        !compact && (
          <>
            <div className="field">
              <label htmlFor={`${uid}-title`}>Τίτλος</label>
              <input id={`${uid}-title`} name="title" className="input" maxLength={200} defaultValue={defaultTitle} placeholder="π.χ. Ενεργειακό πιστοποιητικό" />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-cat`}>Κατηγορία</label>
              <select id={`${uid}-cat`} name="category" className="select" defaultValue={defaultCategory}>
                {Object.entries(DOCUMENT_CATEGORY_LABELS).filter(([k]) => k !== "MANDATE").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <label className="row" style={{ gap: 6, alignSelf: "end" }}>
              <input type="checkbox" name="personal" /> Περιέχει προσωπικά δεδομένα
            </label>
          </>
        )
      )}
      {compact && mode === "document" && <input type="hidden" name="title" value={defaultTitle ?? ""} />}
      <div className={compact ? "row" : "span2 row"}>
        <button type="submit" className={compact ? "btn btn--outline btn--sm" : "btn btn--primary btn--sm"} disabled={busy}>
          {busy ? "Μεταφόρτωση…" : mode === "signed-copy" ? "Καταχώριση υπογεγραμμένου" : "Ανέβασμα"}
        </button>
        {message && <span className={message.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{message.text}</span>}
      </div>
    </form>
  );
}
