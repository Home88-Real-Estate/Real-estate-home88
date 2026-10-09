/**
 * The conversation's memory, as plain data and pure functions.
 *
 * What an agent has told us lives in `fields`, each value with its ORIGIN:
 *   AGENT_STATED   said or typed by the agent in the conversation
 *   AGENT_MANUAL   typed into the review form
 *   SYSTEM_DERIVED computed by HOME88 from other stated facts (e.g. a title)
 *   AI_SUGGESTED   proposed by the model and not backed by the agent's words
 * Only AGENT_* values count as the agent's own; the rest need an explicit
 * confirmation before they can reach the property.
 *
 * The model proposes; this file decides. A proposal is applied only if its
 * key is on the allowlist, its value passes the field's own validation and it
 * quotes words the agent actually said. Anything else is dropped or parked as
 * a question - never written.
 */

import { coerceValue, specByKey, type FieldSpec } from "./fields";

export type Origin = "AGENT_STATED" | "AGENT_MANUAL" | "SYSTEM_DERIVED" | "AI_SUGGESTED";
export type Value = string | number | boolean;
export type Lang = "el" | "en";

export type Entry = { value: Value; origin: Origin; confirmed: boolean; evidence?: string; updatedAt: string };

export type Pending = {
  key: string;
  proposed: Value;
  current?: Value;
  reason: "conflict" | "unverified";
  origin: Origin;
  evidence?: string;
};

export type UndoStep = { key: string; previous: Entry | null };

export type IntakeState = {
  fields: Record<string, Entry>;
  /** Keys the agent said they do not know or want to leave out. */
  skipped: string[];
  pending: Pending[];
  /** The field the assistant last asked about; a short answer ("yes", "third") refers to it. */
  asked: string | null;
  lang: Lang;
  muted: boolean;
  photosLater: boolean;
  stage: "collect" | "review";
  undo: UndoStep[];
};

export function emptyState(): IntakeState {
  return { fields: {}, skipped: [], pending: [], asked: null, lang: "el", muted: false, photosLater: false, stage: "collect", undo: [] };
}

/** Defensive read of the stored JSON: unknown shapes become an empty conversation, never an error. */
export function readState(raw: unknown): IntakeState {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<IntakeState>;
  return {
    fields: r.fields && typeof r.fields === "object" ? r.fields : base.fields,
    skipped: Array.isArray(r.skipped) ? r.skipped.filter((k): k is string => typeof k === "string") : [],
    pending: Array.isArray(r.pending) ? r.pending : [],
    asked: typeof r.asked === "string" ? r.asked : null,
    lang: r.lang === "en" ? "en" : "el",
    muted: r.muted === true,
    photosLater: r.photosLater === true,
    stage: r.stage === "review" ? "review" : "collect",
    undo: Array.isArray(r.undo) ? r.undo.slice(-20) : [],
  };
}

export type Proposal = {
  key: string;
  value: unknown;
  confidence: "high" | "medium" | "low";
  /** The agent's own words that this value comes from. */
  evidence: string;
  /** The agent is changing something already captured ("change the price to ..."). */
  isCorrection: boolean;
};

export type ApplyOutcome = {
  state: IntakeState;
  applied: Array<{ key: string; value: Value; previous?: Value }>;
  pending: Pending[];
  rejected: Array<{ key: string; reason: string }>;
};

/** Lower-case, accent-free, punctuation-free text, for checking that evidence really was said. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function evidenceWasSaid(evidence: string, utterance: string): boolean {
  const e = normalizeForMatch(evidence);
  if (e.length < 2) return false;
  return normalizeForMatch(utterance).includes(e);
}

function push(state: IntakeState, key: string): void {
  state.undo = [...state.undo, { key, previous: state.fields[key] ?? null }].slice(-20);
}

function setEntry(state: IntakeState, key: string, entry: Entry): void {
  push(state, key);
  state.fields[key] = entry;
  state.skipped = state.skipped.filter((k) => k !== key);
  state.pending = state.pending.filter((p) => p.key !== key);
}

const isAgent = (e: Entry | undefined) => e?.origin === "AGENT_STATED" || e?.origin === "AGENT_MANUAL";

/**
 * Applies the model's proposals to a COPY of the state. Returns what was
 * applied, what needs the agent's confirmation and what was refused.
 */
export function applyProposals(
  before: IntakeState,
  proposals: Proposal[],
  utterance: string,
  specs: FieldSpec[],
  now: Date = new Date(),
): ApplyOutcome {
  const state: IntakeState = structuredClone(before);
  const applied: ApplyOutcome["applied"] = [];
  const pending: Pending[] = [];
  const rejected: ApplyOutcome["rejected"] = [];
  const at = now.toISOString();

  // Two different values for one key in one utterance is ambiguity, not a fact.
  const byKey = new Map<string, Proposal[]>();
  for (const p of proposals) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);

  for (const [key, list] of byKey) {
    const spec = specByKey(specs, key);
    if (!spec) {
      rejected.push({ key, reason: "not_allowed" });
      continue;
    }
    const coerced = list.map((p) => ({ p, c: coerceValue(spec, p.value) }));
    const valid = coerced.filter((x): x is { p: Proposal; c: { ok: true; value: Value } } => x.c.ok);
    for (const bad of coerced) if (!bad.c.ok) rejected.push({ key, reason: bad.c.reason });
    if (valid.length === 0) continue;

    const distinct = new Set(valid.map((v) => String(v.c.value)));
    if (distinct.size > 1) {
      const [first, last] = [valid[0]!, valid[valid.length - 1]!];
      const item: Pending = { key, proposed: last.c.value, current: first.c.value, reason: "conflict", origin: "AI_SUGGESTED", evidence: last.p.evidence };
      state.pending = [...state.pending.filter((x) => x.key !== key), item];
      pending.push(item);
      continue;
    }

    const { p, c } = valid[valid.length - 1]!;
    const value = c.value;
    const said = p.confidence !== "low" && evidenceWasSaid(p.evidence, utterance);
    const existing = state.fields[key];

    if (existing && existing.value === value) {
      if (said && !existing.confirmed) state.fields[key] = { ...existing, confirmed: true, origin: existing.origin === "AI_SUGGESTED" ? "AGENT_STATED" : existing.origin, updatedAt: at };
      continue;
    }

    if (!said) {
      // Not clearly the agent's words: hold it as a question, never as a fact.
      const item: Pending = { key, proposed: value, current: existing?.value, reason: "unverified", origin: "AI_SUGGESTED", evidence: p.evidence || undefined };
      state.pending = [...state.pending.filter((x) => x.key !== key), item];
      pending.push(item);
      continue;
    }

    if (existing && isAgent(existing) && !p.isCorrection) {
      const item: Pending = { key, proposed: value, current: existing.value, reason: "conflict", origin: "AGENT_STATED", evidence: p.evidence };
      state.pending = [...state.pending.filter((x) => x.key !== key), item];
      pending.push(item);
      continue;
    }

    setEntry(state, key, { value, origin: "AGENT_STATED", confirmed: true, evidence: p.evidence, updatedAt: at });
    applied.push({ key, value, previous: existing?.value });
  }

  return { state, applied, pending, rejected };
}

/** The agent accepts or declines a held value. */
export function resolvePending(before: IntakeState, key: string, accept: boolean, now: Date = new Date()): IntakeState {
  const state = structuredClone(before);
  const item = state.pending.find((p) => p.key === key);
  if (!item) return state;
  if (accept) {
    setEntry(state, key, {
      value: item.proposed,
      origin: item.origin === "AGENT_STATED" ? "AGENT_STATED" : "AI_SUGGESTED",
      confirmed: true,
      evidence: item.evidence,
      updatedAt: now.toISOString(),
    });
  } else {
    state.pending = state.pending.filter((p) => p.key !== key);
  }
  return state;
}

/** A value typed or tapped in by the agent: authoritative, and checked like any other. */
export function setManual(before: IntakeState, key: string, raw: unknown, specs: FieldSpec[], now: Date = new Date()): { state: IntakeState; error?: string } {
  const spec = specByKey(specs, key);
  if (!spec) return { state: before, error: "not_allowed" };
  const c = coerceValue(spec, raw);
  if (!c.ok) return { state: before, error: c.reason };
  const state = structuredClone(before);
  setEntry(state, key, { value: c.value, origin: "AGENT_MANUAL", confirmed: true, updatedAt: now.toISOString() });
  return { state };
}

/** A computed or generated value (title, description): kept, but unconfirmed until the agent accepts it. */
export function setDerived(before: IntakeState, key: string, value: string, origin: "SYSTEM_DERIVED" | "AI_SUGGESTED", now: Date = new Date()): IntakeState {
  const state = structuredClone(before);
  // Never overwrite what the agent wrote or already confirmed.
  if (state.fields[key]?.confirmed) return state;
  push(state, key);
  state.fields[key] = { value, origin, confirmed: false, updatedAt: now.toISOString() };
  return state;
}

export function confirmField(before: IntakeState, key: string, now: Date = new Date()): IntakeState {
  const e = before.fields[key];
  if (!e) return before;
  const state = structuredClone(before);
  state.fields[key] = { ...e, confirmed: true, updatedAt: now.toISOString() };
  return state;
}

export function clearField(before: IntakeState, key: string): IntakeState {
  if (!before.fields[key]) return before;
  const state = structuredClone(before);
  push(state, key);
  delete state.fields[key];
  state.pending = state.pending.filter((p) => p.key !== key);
  return state;
}

export function skipField(before: IntakeState, key: string): IntakeState {
  const state = structuredClone(before);
  if (!state.skipped.includes(key)) state.skipped.push(key);
  state.pending = state.pending.filter((p) => p.key !== key);
  if (state.asked === key) state.asked = null;
  return state;
}

/** "Go back": restores the previous value of the most recent change. */
export function undoLast(before: IntakeState): { state: IntakeState; key?: string } {
  const step = before.undo[before.undo.length - 1];
  if (!step) return { state: before };
  const state = structuredClone(before);
  state.undo = state.undo.slice(0, -1);
  if (step.previous) state.fields[step.key] = step.previous;
  else delete state.fields[step.key];
  return { state, key: step.key };
}

export type NextStep =
  | { type: "confirm"; pending: Pending }
  | { type: "ask"; key: string }
  | { type: "review" };

/** The order a visit naturally goes: what and why first, then price, size, place, then the rest worth knowing. */
export function nextStep(state: IntakeState, specs: FieldSpec[], order: string[]): NextStep {
  if (state.pending.length > 0) return { type: "confirm", pending: state.pending[0]! };
  for (const key of order) {
    if (!specByKey(specs, key)) continue;
    if (state.fields[key] || state.skipped.includes(key)) continue;
    return { type: "ask", key };
  }
  return { type: "review" };
}
