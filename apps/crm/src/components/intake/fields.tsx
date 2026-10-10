"use client";

import { useMemo, useState } from "react";

import type { IntakeOrigin, IntakeSession } from "@/lib/intake-client";

export type Spec = IntakeSession["catalog"][number];
export type FieldValue = string | number | boolean;

export const ORIGIN_LABEL: Record<IntakeOrigin, { text: string; className: string }> = {
  AGENT_STATED: { text: "Από εσάς", className: "badge badge--ok" },
  AGENT_MANUAL: { text: "Από εσάς", className: "badge badge--ok" },
  SYSTEM_DERIVED: { text: "Αυτόματη πρόταση", className: "badge badge--warn" },
  AI_SUGGESTED: { text: "Πρόταση AI", className: "badge badge--warn" },
};

/** Turns what was typed into the value the API expects for this field; null = clear it. */
export function parseInput(spec: Spec, raw: string): FieldValue | null {
  const v = raw.trim();
  if (!v) return null;
  if (spec.kind === "bool") return v === "true";
  if (spec.kind === "int" || spec.kind === "decimal") return Number(v.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return v;
}

export function ValueInput({ spec, value, onChange, id, autoFocus }: { spec: Spec; value: string; onChange: (v: string) => void; id: string; autoFocus?: boolean }) {
  if (spec.kind === "bool") {
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus}>
        <option value="">—</option>
        <option value="true">Ναι</option>
        <option value="false">Όχι</option>
      </select>
    );
  }
  if (spec.kind === "select") {
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus}>
        <option value="">—</option>
        {spec.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  const numeric = spec.kind === "int" || spec.kind === "decimal";
  return (
    <input
      id={id}
      type={spec.kind === "date" ? "date" : "text"}
      inputMode={numeric ? (spec.kind === "int" ? "numeric" : "decimal") : undefined}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

type RowProps = {
  spec: Spec;
  session: IntakeSession;
  disabled: boolean;
  onSet: (key: string, value: FieldValue | null) => Promise<boolean>;
  onConfirm: (key: string) => void;
};

/** One field: its value as the agent sees it, where it came from, and an inline editor. */
export function FieldRow({ spec, session, disabled, onSet, onConfirm }: RowProps) {
  const entry = session.fields[spec.key];
  const display = session.review.rows.find((r) => r.key === spec.key)?.display;
  const [draft, setDraft] = useState<string | null>(null);
  const id = `f-${spec.key}`;

  async function save() {
    if (draft === null) return;
    if (await onSet(spec.key, parseInput(spec, draft))) setDraft(null);
  }

  return (
    <div className={entry ? "ifield is-filled" : "ifield"}>
      <label className="ifield__label" htmlFor={id}>
        {spec.label}
        {spec.unit && <span className="hint"> ({spec.unit})</span>}
      </label>
      {draft !== null ? (
        <div className="ifield__edit">
          <ValueInput spec={spec} id={id} value={draft} onChange={setDraft} autoFocus />
          <button type="button" className="btn btn--primary btn--sm" disabled={disabled} onClick={() => void save()}>Αποθήκευση</button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft(null)}>Άκυρο</button>
        </div>
      ) : (
        <div className="ifield__value">
          <button type="button" className="ifield__show" disabled={disabled} onClick={() => setDraft(entry ? String(entry.value) : "")} aria-label={`${entry ? "Αλλαγή" : "Συμπλήρωση"}: ${spec.label}`}>
            {entry ? display ?? String(entry.value) : <span className="muted">Συμπληρώστε</span>}
          </button>
          {entry && !entry.confirmed && (
            <>
              <span className={ORIGIN_LABEL[entry.origin].className}>{ORIGIN_LABEL[entry.origin].text}</span>
              <button type="button" className="btn btn--outline btn--sm" disabled={disabled} onClick={() => onConfirm(spec.key)}>Επιβεβαίωση</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Yes/no features as chips: one tap sets "yes", a second tap clears it. */
export function FeatureChips({ specs, session, disabled, onSet }: { specs: Spec[]; session: IntakeSession; disabled: boolean; onSet: RowProps["onSet"] }) {
  if (specs.length === 0) return null;
  return (
    <div className="ichips" role="group" aria-label="Παροχές">
      {specs.map((s) => {
        const v = session.fields[s.key]?.value;
        const state = v === true ? "yes" : v === false ? "no" : "unknown";
        return (
          <button
            key={s.key}
            type="button"
            className={`ichip ichip--${state}`}
            aria-pressed={state === "yes"}
            disabled={disabled}
            onClick={() => void onSet(s.key, state === "yes" ? null : true)}
            title={state === "no" ? "Δηλώθηκε ότι δεν υπάρχει· πατήστε για «υπάρχει»" : undefined}
          >
            {state === "yes" ? "✓ " : state === "no" ? "✕ " : ""}{s.label}
          </button>
        );
      })}
    </div>
  );
}

/** Every other field of this property type, searchable, instead of one enormous dropdown. */
export function FieldPicker({ specs, onPick }: { specs: Spec[]; onPick: (key: string) => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = q.trim().toLocaleLowerCase("el").normalize("NFD").replace(/\p{M}/gu, "");
    return specs.filter((s) => !n || s.label.toLocaleLowerCase("el").normalize("NFD").replace(/\p{M}/gu, "").includes(n)).slice(0, 60);
  }, [q, specs]);
  if (specs.length === 0) return null;
  return (
    <div className="ipicker">
      <label className="sr-only" htmlFor="ipicker-q">Αναζήτηση χαρακτηριστικού</label>
      <input id="ipicker-q" type="search" placeholder={`Αναζήτηση σε ${specs.length} ακόμη χαρακτηριστικά…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ichips">
        {shown.map((s) => (
          <button key={s.key} type="button" className="ichip" onClick={() => onPick(s.key)}>+ {s.label}</button>
        ))}
        {shown.length === 0 && <span className="hint">Κανένα χαρακτηριστικό με αυτό το όνομα.</span>}
      </div>
    </div>
  );
}
