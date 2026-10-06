"use client";

import { useActionState } from "react";

import { cancelShowing, issueShowing, sendShowing } from "@/actions/contacts";
import { idleState } from "@/lib/form";

function Msg({ state }: { state: { ok: boolean; message?: string } }) {
  return state.message ? <p className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{state.message}</p> : null;
}

export function IssueForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(issueShowing, idleState);
  return (
    <form action={action} className="no-print">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "Έκδοση…" : "Έκδοση εντολής υπόδειξης"}</button>
      <p className="hint muted small" style={{ margin: "6px 0 0" }}>Δίνεται αριθμός, δημιουργείται το PDF από το εγκεκριμένο πρότυπο και το κείμενο κλειδώνει.</p>
      <Msg state={state} />
    </form>
  );
}

export function SendForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(sendShowing, idleState);
  return (
    <form action={action} className="no-print">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn btn--outline" disabled={pending}>{pending ? "Αποστολή…" : "Αποστολή για ψηφιακή υπογραφή"}</button>
      <Msg state={state} />
    </form>
  );
}

export function CancelForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelShowing, idleState);
  return (
    <details className="no-print">
      <summary className="btn btn--ghost btn--sm">Ακύρωση υπόδειξης</summary>
      <form action={action} style={{ marginTop: 8 }}>
        <input type="hidden" name="id" value={id} />
        <div className="field"><label htmlFor="cancel-reason">Λόγος ακύρωσης</label><textarea id="cancel-reason" name="reason" className="textarea" rows={2} maxLength={1000} /></div>
        <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>Επιβεβαίωση ακύρωσης</button>
        <Msg state={state} />
      </form>
    </details>
  );
}

export function PrintButton() {
  return <button type="button" className="btn btn--outline no-print" onClick={() => window.print()}>Εκτύπωση</button>;
}
