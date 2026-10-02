"use client";

import { useActionState } from "react";
import { USER_ROLE_LABELS, label } from "@home88/types";

import { inviteUserAction } from "@/actions/invitations";
import { idleState } from "@/lib/form";

export function InviteForm({ assignableRoles }: { assignableRoles: string[] }) {
  const [state, action, pending] = useActionState(inviteUserAction, idleState);
  const error = (name: string) => state.fields?.[name]?.[0];
  const defaultRole = assignableRoles[0] ?? "AGENT";

  return (
    <form action={action}>
      {state.message && (
        <div
          className={state.ok ? "notice notice--ok" : "notice notice--danger"}
          role="alert"
          style={{ marginBottom: 16 }}
        >
          {state.message}
        </div>
      )}

      <div className="formgrid">
        <div className="field span2">
          <label htmlFor="email">Email *</label>
          <input id="email" name="email" type="email" className="input" required />
          {error("email") && <span className="error">{error("email")}</span>}
        </div>

        <div className="field">
          <label htmlFor="firstName">First name *</label>
          <input id="firstName" name="firstName" type="text" className="input" required />
          {error("firstName") && <span className="error">{error("firstName")}</span>}
        </div>

        <div className="field">
          <label htmlFor="lastName">Last name *</label>
          <input id="lastName" name="lastName" type="text" className="input" required />
          {error("lastName") && <span className="error">{error("lastName")}</span>}
        </div>

        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input id="phone" name="phone" type="text" className="input" />
          {error("phone") && <span className="error">{error("phone")}</span>}
        </div>

        <div className="field">
          <label htmlFor="role">Role</label>
          <select id="role" name="role" className="select" defaultValue={defaultRole}>
            {assignableRoles.map((value) => (
              <option key={value} value={value}>
                {label(USER_ROLE_LABELS, value, "el")}
              </option>
            ))}
          </select>
          {error("role") && <span className="error">{error("role")}</span>}
        </div>
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <button type="submit" className="btn btn--primary" disabled={pending || assignableRoles.length === 0}>
          {pending ? "Αποστολή..." : "Αποστολή πρόσκλησης"}
        </button>
        <span className="hint">Ο συνεργάτης ορίζει μόνος του τον κωδικό από τον σύνδεσμο.</span>
      </div>
    </form>
  );
}
