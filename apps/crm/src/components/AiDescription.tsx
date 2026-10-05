"use client";

import { useState, useTransition } from "react";

import { draftDescription, type AiDraft } from "@/actions/ai";

/**
 * A draft description from the AI assistant, for the agent to review. It is
 * written from the property's saved details (never the owner or the address)
 * and goes into the field only when the agent presses "Χρήση", after which it
 * is saved like any other edit.
 */
export function AiDescription({ propertyId, onUse }: { propertyId: string; onUse: (locale: "el" | "en", text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState<"el" | "en">("el");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [pending, start] = useTransition();

  function generate() {
    start(async () => setDraft(await draftDescription(propertyId, locale, notes)));
  }

  return (
    <div className="ai">
      <button type="button" className="btn btn--outline btn--sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Πρόχειρο από AI
      </button>
      {open && (
        <div className="ai__panel">
          <p className="muted ai__hint">
            Γράφεται από τα αποθηκευμένα στοιχεία του ακινήτου (χωρίς διεύθυνση ή στοιχεία ιδιοκτήτη). Οι αλλαγές της φόρμας που δεν έχουν αποθηκευτεί δεν λαμβάνονται υπόψη.
          </p>
          <div className="formgrid">
            <div className="field">
              <label htmlFor="ai-locale">Γλώσσα</label>
              <select id="ai-locale" className="select" value={locale} onChange={(e) => setLocale(e.target.value as "el" | "en")}>
                <option value="el">Ελληνικά</option>
                <option value="en">Αγγλικά</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ai-notes">Οδηγίες (προαιρετικά)</label>
              <input id="ai-notes" className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="π.χ. τόνισε το μπαλκόνι" />
              <span className="muted ai__hint">Χωρίς ονόματα, τηλέφωνα ή email· δεν στέλνονται σε εξωτερική υπηρεσία.</span>
            </div>
          </div>
          <button type="button" className="btn btn--primary btn--sm" onClick={generate} disabled={pending}>
            {pending ? "Γράφεται…" : draft?.ok ? "Νέο πρόχειρο" : "Δημιουργία προχείρου"}
          </button>
          {draft && !draft.ok && (
            <p className="error" role="alert">
              {draft.message}
            </p>
          )}
          {draft?.ok && draft.text && (
            <div className="ai__draft" aria-live="polite">
              <p className="notice">{draft.notice}</p>
              <pre className="ai__text">{draft.text}</pre>
              {draft.truncated && <p className="muted">Το κείμενο κόπηκε στο όριο μήκους· ελέγξτε το τέλος.</p>}
              <div className="ai__actions">
                <button type="button" className="btn btn--primary btn--sm" onClick={() => { onUse(locale, draft.text!); setDraft(null); }}>
                  Χρήση στο πεδίο
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft(null)}>
                  Απόρριψη
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
