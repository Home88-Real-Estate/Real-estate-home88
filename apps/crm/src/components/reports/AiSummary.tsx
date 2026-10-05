"use client";

import { useState, useTransition } from "react";

import { summariseReport, type AiDraft } from "@/actions/ai";

/** A short written summary of the numbers on this page, drafted by the AI assistant from the totals only. */
export function AiSummary({ kind, query }: { kind: string; query: { range?: string; from?: string; to?: string; scope?: string } }) {
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="ai ai--report">
      <button type="button" className="btn btn--outline btn--sm" disabled={pending} onClick={() => start(async () => setDraft(await summariseReport(kind, query)))}>
        {pending ? "Γράφεται…" : "Σύνοψη από AI"}
      </button>
      {draft && !draft.ok && (
        <p className="error" role="alert">
          {draft.message}
        </p>
      )}
      {draft?.ok && (
        <div className="ai__draft" aria-live="polite">
          <p className="notice">{draft.notice}</p>
          <p className="ai__text ai__text--prose">{draft.text}</p>
        </div>
      )}
    </div>
  );
}
