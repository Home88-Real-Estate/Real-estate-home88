"use client";

import { useActionState } from "react";

import { createContactReminder } from "@/actions/contacts";
import { TASK_PRIORITY_LABEL } from "@/lib/labels";
import { idleState } from "@/lib/form";

/** Adds a reminder through the existing reminders module, linked to a contact (and optionally a showing). */
export function ReminderForm({ contactId, showingId, defaultTitle = "" }: { contactId: string; showingId?: string; defaultTitle?: string }) {
  const [state, action, pending] = useActionState(createContactReminder, idleState);
  const err = (k: string) => state.fields?.[k]?.[0];
  return (
    <form action={action} className="subpanel" noValidate key={state.ok ? "done" : "open"}>
      <input type="hidden" name="contactId" value={contactId} />
      {showingId && <input type="hidden" name="showingId" value={showingId} />}
      <div className="formgrid">
        <div className="field span2">
          <label htmlFor={`rt-${showingId ?? "c"}`}>Τίτλος</label>
          <input id={`rt-${showingId ?? "c"}`} name="title" className="input" maxLength={200} defaultValue={defaultTitle} />
          {err("title") && <span className="error">{err("title")}</span>}
        </div>
        <div className="field">
          <label htmlFor={`rd-${showingId ?? "c"}`}>Πότε</label>
          <input id={`rd-${showingId ?? "c"}`} name="dueAt" type="datetime-local" className="input" />
          {err("dueAt") && <span className="error">{err("dueAt")}</span>}
        </div>
        <div className="field">
          <label htmlFor={`rp-${showingId ?? "c"}`}>Προτεραιότητα</label>
          <select id={`rp-${showingId ?? "c"}`} name="priority" className="select" defaultValue="NORMAL">
            {Object.entries(TASK_PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      {state.message && <p className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{state.message}</p>}
      <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>{pending ? "Αποθήκευση…" : "Προσθήκη υπενθύμισης"}</button>
    </form>
  );
}
