"use client";

import { useActionState } from "react";

import { sendTestEmail } from "@/actions/settings";
import { idleState } from "@/lib/form";

export function TestEmailButton() {
  const [state, action, pending] = useActionState(sendTestEmail, idleState);
  return (
    <form action={action} className="testmail">
      <p className="muted">Στέλνει ένα δοκιμαστικό μήνυμα στο email του λογαριασμού σας με τις αποθηκευμένες ρυθμίσεις.</p>
      <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>
        {pending ? "Αποστολή…" : "Δοκιμαστικό email"}
      </button>
      {state.message && <p className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{state.message}</p>}
    </form>
  );
}
