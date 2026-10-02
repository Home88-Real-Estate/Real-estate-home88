"use client";

import { useActionState } from "react";

import { changePasswordAction } from "@/actions/auth";
import { idleState } from "@/lib/form";

export function ChangePasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changePasswordAction, idleState);

  return (
    <div className="panel" style={{ maxWidth: 520 }}>
      <h2>Αλλαγή κωδικού</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Συνδεδεμένος ως <strong>{email}</strong>. Οι άλλες ενεργές συνεδρίες θα
        αποσυνδεθούν μετά την αλλαγή.
      </p>

      <form action={action}>
        {state.message && (
          <div
            className={state.ok ? "notice notice--ok" : "notice notice--danger"}
            role="alert"
            style={{ marginBottom: 12 }}
          >
            {state.message}
          </div>
        )}

        <div className="field">
          <label htmlFor="currentPassword">Τρέχων κωδικός</label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            className="input"
            autoComplete="current-password"
            required
          />
          {state.fields?.currentPassword?.[0] && (
            <span className="error">{state.fields.currentPassword[0]}</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="newPassword">Νέος κωδικός</label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            className="input"
            autoComplete="new-password"
            required
          />
          <span className="hint">
            Τουλάχιστον 12 χαρακτήρες με πεζά, κεφαλαία, αριθμό και σύμβολο.
          </span>
          {state.fields?.newPassword?.[0] && (
            <span className="error">{state.fields.newPassword[0]}</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="confirmPassword">Επιβεβαίωση νέου κωδικού</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            className="input"
            autoComplete="new-password"
            required
          />
          {state.fields?.confirmPassword?.[0] && (
            <span className="error">{state.fields.confirmPassword[0]}</span>
          )}
        </div>

        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Αποθήκευση..." : "ΑΛΛΑΓΗ ΚΩΔΙΚΟΥ"}
        </button>
      </form>
    </div>
  );
}
