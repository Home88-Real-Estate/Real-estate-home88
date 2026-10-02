"use client";

import Link from "next/link";
import { useActionState } from "react";

import { acceptInvitationAction } from "@/actions/invitations";
import { idleState } from "@/lib/form";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitationAction, idleState);

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
        <label htmlFor="password">Κωδικός</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="new-password"
          required
          autoFocus
        />
        <span className="hint">
          Τουλάχιστον 12 χαρακτήρες με πεζά, κεφαλαία, αριθμό και σύμβολο.
        </span>
        {state.fields?.password?.[0] && <span className="error">{state.fields.password[0]}</span>}
      </div>

      <div className="field">
        <label htmlFor="confirmPassword">Επιβεβαίωση κωδικού</label>
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

      <button type="submit" className="btn btn--primary" style={{ width: "100%" }} disabled={pending}>
        {pending ? "Ενεργοποίηση..." : "ΕΝΕΡΓΟΠΟΙΗΣΗ ΛΟΓΑΡΙΑΣΜΟΥ"}
      </button>
    </form>
  );
}
