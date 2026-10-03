"use client";

import { useActionState } from "react";

import { createTemplateVersion, updateTemplateVersion } from "@/actions/settings";
import { idleState } from "@/lib/form";

export function NewVersionForm({ type, locale, label }: { type: string; locale: string; label: string }) {
  const [state, action, pending] = useActionState(createTemplateVersion, idleState);
  const error = (k: string) => state.fields?.[k]?.[0];
  return (
    <form action={action} className="sform">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="locale" value={locale} />
      {state.message && !state.ok && <div className="notice notice--danger" role="alert">{state.message}</div>}
      <div className="field">
        <label htmlFor={`body-${type}-${locale}`}>Εγκεκριμένο κείμενο · {label}</label>
        <textarea id={`body-${type}-${locale}`} name="body" className="textarea textarea--tall" required minLength={20} placeholder="Επικολλήστε το κείμενο όπως το ενέκρινε ο δικηγόρος σας." />
        {error("body") && <span className="error">{error("body")}</span>}
      </div>
      <div className="field">
        <label htmlFor={`notes-${type}-${locale}`}>Σημείωση έκδοσης</label>
        <input id={`notes-${type}-${locale}`} name="notes" className="input" maxLength={500} placeholder="π.χ. Έγκριση δικηγόρου 10/2026" />
      </div>
      <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>Αποθήκευση ως πρόχειρη</button>
    </form>
  );
}

export function EditDraftForm({ id, body, notes }: { id: string; body: string; notes: string | null }) {
  const [state, action, pending] = useActionState(updateTemplateVersion, idleState);
  const error = (k: string) => state.fields?.[k]?.[0];
  return (
    <form action={action} className="sform">
      <input type="hidden" name="id" value={id} />
      {state.message && <div className={state.ok ? "notice notice--ok" : "notice notice--danger"} role="status">{state.message}</div>}
      <div className="field">
        <label htmlFor="draft-body">Κείμενο</label>
        <textarea id="draft-body" name="body" className="textarea textarea--tall" defaultValue={body} required />
        {error("body") && <span className="error">{error("body")}</span>}
      </div>
      <div className="field">
        <label htmlFor="draft-notes">Σημείωση έκδοσης</label>
        <input id="draft-notes" name="notes" className="input" defaultValue={notes ?? ""} maxLength={500} />
      </div>
      <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>Αποθήκευση πρόχειρου</button>
    </form>
  );
}
