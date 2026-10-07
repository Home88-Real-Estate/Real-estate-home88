"use client";

import { useActionState } from "react";

import { permanentlyDeleteProperty } from "@/actions/properties";
import { idleState } from "@/lib/form";

/**
 * Removes the row for good. Only offered when the property is already in the
 * deleted folder, only to administrators, and only after a typed confirmation.
 */
export function PermanentDeleteButton({ id, title }: { id: string; title: string }) {
  const [state, formAction, pending] = useActionState(permanentlyDeleteProperty, idleState);

  return (
    <form
      action={formAction}
      className="stack"
      onSubmit={(event) => {
        const message = `Οριστική διαγραφή του «${title}»; Τα στοιχεία θα σβηστούν μόνιμα και η ενέργεια δεν αναιρείται.`;
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="btn btn--danger btn--sm">
        {pending ? "Διαγραφή…" : "Οριστική διαγραφή"}
      </button>
      {state.message && (
        <div className="notice notice--danger" role="alert">
          {state.message}
        </div>
      )}
    </form>
  );
}
