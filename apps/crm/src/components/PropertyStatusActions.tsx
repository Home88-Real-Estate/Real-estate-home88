"use client";

import { useActionState } from "react";
import { PROPERTY_STATUS_LABELS, label } from "@home88/types";

import { changePropertyStatus } from "@/actions/properties";
import { idleState } from "@/lib/form";

/** Moves that take the listing off the market get a confirmation step. */
const CONFIRM: Record<string, string> = {
  ARCHIVED: "Αρχειοθέτηση; Το ακίνητο θα αφαιρεθεί και από τον ιστότοπο.",
  SOLD: "Σήμανση ως πωλημένο; Θα αφαιρεθεί από τον ιστότοπο και τα portals.",
  RENTED: "Σήμανση ως νοικιασμένο; Θα αφαιρεθεί από τον ιστότοπο και τα portals.",
  INACTIVE: "Απόσυρση από την αγορά; Θα αφαιρεθεί από τον ιστότοπο και τα portals.",
};

/**
 * One button per move the API says this user may make now. The list comes
 * from the API (`allowedTransitions`); the API re-checks every request.
 */
export function PropertyStatusActions({ id, allowed }: { id: string; allowed: string[] }) {
  const [state, formAction, pending] = useActionState(changePropertyStatus, idleState);

  if (allowed.length === 0) {
    return <p className="muted">Δεν υπάρχουν διαθέσιμες αλλαγές κατάστασης για εσάς.</p>;
  }

  return (
    <form
      action={formAction}
      className="stack"
      onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const message = submitter ? CONFIRM[submitter.value] : undefined;
        if (message && !window.confirm(message)) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="status-reason">Αιτιολογία (προαιρετικά)</label>
        <input id="status-reason" name="reason" className="input" maxLength={500} />
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {allowed.map((status) => (
          <button
            key={status}
            type="submit"
            name="status"
            value={status}
            disabled={pending}
            className={status === "ARCHIVED" ? "btn btn--danger btn--sm" : "btn btn--outline btn--sm"}
          >
            → {label(PROPERTY_STATUS_LABELS, status, "el")}
          </button>
        ))}
      </div>
      {state.message && (
        <div className={state.ok ? "notice notice--ok" : "notice notice--danger"} role="alert">
          {state.message}
        </div>
      )}
    </form>
  );
}
