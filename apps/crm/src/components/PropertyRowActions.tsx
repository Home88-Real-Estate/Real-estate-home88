"use client";

import { useActionState, useState } from "react";

import { rowPropertyAction } from "@/actions/properties";
import { idleState } from "@/lib/form";

type Props = {
  id: string;
  /** Not in the bin yet: offer the move to it. */
  canDelete: boolean;
  /** In the bin: offer the way back. */
  canRestore: boolean;
  /** In the bin and the actor is an administrator: offer removing the row. */
  canPermanentlyDelete: boolean;
};

/** Destructive steps ask first; the messages match what each step does. */
const CONFIRM: Record<string, string> = {
  delete: "Να μεταφερθεί το ακίνητο στα «Διαγραμμένα»; Θα εξαφανιστεί από τη λίστα και τον ιστότοπο.",
  restore: "Να επαναχθεί το ακίνητο στη λίστα ως Πρόχειρο;",
  permanent: "Οριστική διαγραφή; Η ενέργεια δεν αναιρείται και τα στοιχεία του ακινήτου θα σβηστούν.",
};

/** Delete / restore / permanently delete, one small form per table row. */
export function PropertyRowActions({ id, canDelete, canRestore, canPermanentlyDelete }: Props) {
  const [state, formAction, pending] = useActionState(rowPropertyAction, idleState);
  // A server action's FormData does not include the clicked submit button's
  // name/value, so the row's intent is carried by a hidden field instead.
  const [op, setOp] = useState("");

  if (!canDelete && !canRestore && !canPermanentlyDelete) {
    return null;
  }

  return (
    <form
      action={formAction}
      className="row"
      style={{ flexWrap: "wrap", gap: 4 }}
      onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const message = submitter ? CONFIRM[submitter.value] : undefined;
        if (message && !window.confirm(message)) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      {canRestore && (
        <button type="submit" value="restore" onClick={() => setOp("restore")} disabled={pending} className="btn btn--outline btn--sm">
          Επαναφορά
        </button>
      )}
      {canDelete && (
        <button type="submit" value="delete" onClick={() => setOp("delete")} disabled={pending} className="btn btn--danger btn--sm">
          Διαγραφή
        </button>
      )}
      {canPermanentlyDelete && (
        <button type="submit" value="permanent" onClick={() => setOp("permanent")} disabled={pending} className="btn btn--danger btn--sm">
          Οριστική διαγραφή
        </button>
      )}
      {state.message && (
        <span
          role="alert"
          style={{
            flexBasis: "100%",
            fontSize: "0.75rem",
            color: state.ok ? "var(--ink-muted)" : "var(--danger)",
          }}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
