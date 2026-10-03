"use client";

import { useActionState, useEffect, useRef } from "react";

import { createViewing } from "@/actions/work";
import { idleState } from "@/lib/form";

/** New viewing: property by its code, client, date/time and length. */
export function ViewingForm({ defaultReference }: { defaultReference?: string }) {
  const [state, action, pending] = useActionState(createViewing, idleState);
  const form = useRef<HTMLFormElement>(null);
  const error = (key: string) => state.fields?.[key]?.[0];

  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="formgrid">
      <div className="field">
        <label htmlFor="v-ref">Κωδικός ακινήτου *</label>
        <input id="v-ref" name="propertyReference" className="input mono" required placeholder="H88-000123" defaultValue={defaultReference} />
        {error("propertyReference") && <span className="error">{error("propertyReference")}</span>}
      </div>
      <div className="field">
        <label htmlFor="v-client">Πελάτης *</label>
        <input id="v-client" name="clientName" className="input" required />
        {error("clientName") && <span className="error">{error("clientName")}</span>}
      </div>
      <div className="field">
        <label htmlFor="v-phone">Τηλέφωνο</label>
        <input id="v-phone" name="clientPhone" className="input" inputMode="tel" />
      </div>
      <div className="field">
        <label htmlFor="v-email">Email</label>
        <input id="v-email" name="clientEmail" className="input" type="email" />
        {error("clientEmail") && <span className="error">{error("clientEmail")}</span>}
      </div>
      <div className="field">
        <label htmlFor="v-start">Ημερομηνία και ώρα *</label>
        <input id="v-start" name="startsAt" type="datetime-local" className="input" required />
        {error("startsAt") && <span className="error">{error("startsAt")}</span>}
      </div>
      <div className="field">
        <label htmlFor="v-len">Διάρκεια</label>
        <select id="v-len" name="durationMinutes" className="select" defaultValue="30">
          {[15, 30, 45, 60, 90, 120].map((m) => (
            <option key={m} value={m}>
              {m < 60 ? `${m} λεπτά` : `${m / 60} ${m === 60 ? "ώρα" : "ώρες"}`}
            </option>
          ))}
        </select>
      </div>
      <div className="field span2 row">
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Αποθήκευση…" : "Καταχώριση ραντεβού"}
        </button>
        {state.message && (
          <span className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
