"use client";

import { useActionState, useEffect, useRef } from "react";

import { createTask } from "@/actions/work";
import { idleState } from "@/lib/form";
import { TASK_PRIORITY_LABEL } from "@/lib/labels";

/** New reminder. Optional links to a lead or property come in as hidden ids. */
export function TaskForm({ leadId, propertyId }: { leadId?: string; propertyId?: string }) {
  const [state, action, pending] = useActionState(createTask, idleState);
  const form = useRef<HTMLFormElement>(null);
  const error = (key: string) => state.fields?.[key]?.[0];

  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="quickform">
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      {propertyId && <input type="hidden" name="propertyId" value={propertyId} />}
      <div className="field quickform__grow">
        <label htmlFor="task-title">Τι πρέπει να γίνει *</label>
        <input id="task-title" name="title" className="input" required placeholder="π.χ. Τηλέφωνο στον ιδιοκτήτη για την τιμή" />
        {error("title") && <span className="error">{error("title")}</span>}
      </div>
      <div className="field">
        <label htmlFor="task-due">Προθεσμία</label>
        <input id="task-due" name="dueAt" type="datetime-local" className="input" />
        {error("dueAt") && <span className="error">{error("dueAt")}</span>}
      </div>
      <div className="field">
        <label htmlFor="task-priority">Προτεραιότητα</label>
        <select id="task-priority" name="priority" className="select" defaultValue="NORMAL">
          {Object.entries(TASK_PRIORITY_LABEL).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn--primary" disabled={pending}>
        {pending ? "Αποθήκευση…" : "Προσθήκη"}
      </button>
      {state.message && (
        <p className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
