"use client";

import Link from "next/link";
import { useActionState } from "react";

import { resetPasswordAction } from "@/actions/auth";
import { idleState } from "@/lib/form";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, idleState);

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />

      {state.message && (
        <div
          className={state.ok ? "notice notice--ok" : "notice notice--danger"}
          role="alert"
          style={{ marginBottom: 12 }}
        >
          {state.message}
          {state.ok && (
            <>
              {" "}
              <Link href="/login">Σύνδεση</Link>
            </>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="newPassword">Νέος κωδικός</label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          className="input"
          autoComplete="new-password"
          required
          autoFocus
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

      <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={pending}>
        {pending ? "Αποθήκευση..." : "ΟΡΙΣΜΟΣ ΝΕΟΥ ΚΩΔΙΚΟΥ"}
      </button>
    </form>
  );
}
