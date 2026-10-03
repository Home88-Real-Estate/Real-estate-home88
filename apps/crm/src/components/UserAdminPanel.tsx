"use client";

import { useActionState } from "react";

import { setUserPassword, setUserStatus } from "@/actions/users";
import { idleState } from "@/lib/form";

export function UserAdminPanel({
  id,
  status,
  canResetPassword,
  canChangeStatus,
}: {
  id: string;
  status: string;
  canResetPassword: boolean;
  canChangeStatus: boolean;
}) {
  const [state, action, pending] = useActionState(setUserPassword, idleState);

  return (
    <div className="panel">
      <h2>Ασφάλεια</h2>

      {canResetPassword && (
        <form action={action} style={{ marginBottom: 20 }}>
          <input type="hidden" name="id" value={id} />
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
            <label htmlFor="new-password">Νέος κωδικός</label>
            <input
              id="new-password"
              name="password"
              type="password"
              className="input"
              autoComplete="new-password"
              required
            />
            <span className="hint">
              Signs them out of every session. At least 12 characters with uppercase, lowercase, a
              digit and a symbol.
            </span>
            {state.fields?.password?.[0] && <span className="error">{state.fields.password[0]}</span>}
          </div>
          <button type="submit" className="btn btn--outline" disabled={pending}>
            {pending ? "Ενημέρωση…" : "Αλλαγή κωδικού"}
          </button>
        </form>
      )}

      {canChangeStatus && (
        <form action={setUserStatus}>
          <input type="hidden" name="id" value={id} />
          {status === "SUSPENDED" ? (
            <>
              <input type="hidden" name="status" value="ACTIVE" />
              <button type="submit" className="btn btn--primary">
                Επανενεργοποίηση λογαριασμού
              </button>
            </>
          ) : (
            <>
              <input type="hidden" name="status" value="SUSPENDED" />
              <button type="submit" className="btn btn--danger">
                Αναστολή λογαριασμού
              </button>
            </>
          )}
        </form>
      )}
    </div>
  );
}
