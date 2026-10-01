"use client";

import { useActionState } from "react";
import { LEAD_STATUS_LABELS, label } from "@home88/types";

import { changeLeadStatus } from "@/actions/leads";
import { idleState } from "@/lib/form";

const STATUS_OPTIONS = Object.keys(LEAD_STATUS_LABELS).map((key) => [
  key,
  label(LEAD_STATUS_LABELS, key, "el"),
]);

export function LeadStatusForm({ leadId, current }: { leadId: string; current: string }) {
  const [state, formAction, pending] = useActionState(changeLeadStatus, idleState);

  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="leadId" value={leadId} />

      <div className="field">
        <label htmlFor="status">Status</label>
        <select id="status" name="status" className="select" defaultValue={current}>
          {STATUS_OPTIONS.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="note">Note</label>
        <textarea id="note" name="note" className="textarea" placeholder="What happened on this contact?" />
      </div>

      <div className="field">
        <label htmlFor="lostReason">Reason if lost</label>
        <input id="lostReason" name="lostReason" className="input" />
      </div>

      {state.message && (
        <div className={state.ok ? "notice notice--ok" : "notice notice--danger"} role="alert">
          {state.message}
        </div>
      )}

      <button type="submit" className="btn btn--primary" disabled={pending}>
        {pending ? "Updating..." : "Update status"}
      </button>
    </form>
  );
}
