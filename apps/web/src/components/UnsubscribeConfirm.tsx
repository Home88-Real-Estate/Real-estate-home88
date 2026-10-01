"use client";

import { useState } from "react";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; message: string };

export function UnsubscribeConfirm({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function confirm() {
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({
          kind: "error",
          message: typeof body?.message === "string" ? body.message : "Η ενέργεια δεν ήταν δυνατή.",
        });
        return;
      }
      setState({ kind: "done" });
    } catch {
      setState({ kind: "error", message: "Πρόβλημα σύνδεσης. Δοκιμάστε ξανά." });
    }
  }

  if (state.kind === "done") {
    return (
      <div className="notice" role="status">
        <strong>Ολοκληρώθηκε.</strong>
        <p style={{ margin: "6px 0 0" }}>
          Δεν θα λαμβάνετε πλέον ενημερωτικά μηνύματα. Μπορεί να λάβετε μήνυμα σχετικό με ενεργή
          συναλλαγή σας, το οποίο δεν αποτελεί ενημερωτικό δελτίο.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p>Επιβεβαιώστε ότι θέλετε να διαγραφείτε από τα ενημερωτικά μηνύματα.</p>
      {state.kind === "error" && (
        <div className="notice notice--danger" role="alert" style={{ marginBottom: 14 }}>
          {state.message}
        </div>
      )}
      <button
        type="button"
        className="btn btn--primary"
        onClick={confirm}
        disabled={state.kind === "sending"}
      >
        {state.kind === "sending" ? "Γίνεται…" : "Διαγραφή από τη λίστα"}
      </button>
    </div>
  );
}
