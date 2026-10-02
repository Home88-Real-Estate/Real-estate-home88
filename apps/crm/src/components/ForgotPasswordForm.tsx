"use client";

import { useActionState } from "react";

import { requestPasswordResetAction } from "@/actions/auth";
import { idleState } from "@/lib/form";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, idleState);

  return (
    <form action={action}>
      {state.message && (
        <div
          className={state.ok ? "notice notice--ok" : "notice notice--danger"}
          role="status"
          style={{ marginBottom: 14 }}
        >
          {state.message}
        </div>
      )}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          required
          autoFocus
        />
        {state.fields?.email?.[0] && <span className="error">{state.fields.email[0]}</span>}
      </div>

      <button type="submit" className="btn btn--primary" style={{ width: "100%" }} disabled={pending}>
        {pending ? "Αποστολή..." : "ΑΠΟΣΤΟΛΗ ΟΔΗΓΙΩΝ"}
      </button>
    </form>
  );
}
