"use client";

import { useActionState, useState } from "react";
import { PROPERTY_STATUS_LABELS, label } from "@home88/types";

import { changePropertyStatus } from "@/actions/properties";
import { idleState } from "@/lib/form";

/** Moves that take the listing off the market get a confirmation step. */
const CONFIRM: Record<string, string> = {
  ARCHIVED: "Αρχειοθέτηση; Το ακίνητο θα αφαιρεθεί και από τον ιστότοπο.",
  DELETED: "Να μεταφερθεί το ακίνητο στα «Διαγραμμένα»; Θα εξαφανιστεί από τη λίστα και τον ιστότοπο.",
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
  // A server action's FormData does not include the clicked submit button's
  // name/value, so the target status is carried by a hidden field instead.
  const [status, setStatus] = useState("");

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
      <input type="hidden" name="status" value={status} />
      <div className="field">
        <label htmlFor="status-reason">Αιτιολογία (προαιρετικά)</label>
        <input id="status-reason" name="reason" className="input" maxLength={500} />
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {allowed.map((next) => (
          <button
            key={next}
            type="submit"
            value={next}
            onClick={() => setStatus(next)}
            disabled={pending}
            className={
              next === "ARCHIVED" || next === "DELETED"
                ? "btn btn--danger btn--sm"
                : "btn btn--outline btn--sm"
            }
          >
            → {label(PROPERTY_STATUS_LABELS, next, "el")}
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
