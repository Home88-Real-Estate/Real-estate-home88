"use client";

import { useActionState } from "react";

import { runAutomationsNow } from "@/actions/automation";
import { idleState } from "@/lib/form";

export function RunAutomations() {
  const [state, action, pending] = useActionState(runAutomationsNow, idleState);
  return (
    <form action={action} className="run-now">
      <button type="submit" className="btn btn--outline" disabled={pending}>
        {pending ? "Εκτελείται…" : "Εκτέλεση τώρα"}
      </button>
      {state.message && (
        <span className={state.ok ? "muted" : "error"} role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
