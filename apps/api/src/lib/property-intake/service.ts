/**
 * The property intake assistant: sessions, turns, review and creation.
 *
 * The AI proposes; this file (with state.ts) decides. A session is the agent's
 * own, resumable, and holds only structured answers plus a short transcript.
 * Creating the property goes through the same function as the CRM form
 * (`createPropertyInTx`), exactly once per session, as a DRAFT that is never
 * published: nothing here sets a publication flag or calls a portal.
 */

import type { Prisma, PrismaClient } from "@home88/database";
import { completeness, normalizeForProfile, requiredIssues } from "@home88/domain";
import { propertyUpsertSchema } from "@home88/validation";

import { createPropertyInTx, type CreateMeta } from "../../routes/properties";
import { writeAudit } from "../audit";
import { HttpError, notFound } from "../errors";
import { intakeAiConfig } from "./config";
import { extractionJsonSchema, extractionSystemPrompt, extractionUserPrompt, parseExtraction } from "./extraction";
import { allowedFields, LISTING_TYPES, PROPERTY_TYPES, ROOT_SPECS, specByKey, type FieldSpec } from "./fields";
import { questionOrder } from "./flow";
import { IntakeAiError, type IntakeAiPort, type LanguagePreference } from "./ai";
import {
  acknowledge, composeReply, confirmQuestion, label, pickLanguage, questionFor, reply, skippedNote, valueText,
} from "./replies";
import {
  applyProposals, clearField, confirmField, emptyState, nextStep, readState, resolvePending, setDerived, setManual,
  skipField, undoLast, type IntakeState, type Lang, type Origin, type Value,
} from "./state";

type Db = PrismaClient;
const MAX_TURNS = 30;

export type Turn = { role: "agent" | "assistant"; text: string; at: string; lang?: Lang };

export type ReviewRow = { key: string; label: string; display: string; origin: Origin; confirmed: boolean; needsConfirmation: boolean };
export type Review = { rows: ReviewRow[]; blockers: string[]; warnings: string[]; missing: string[]; ignored: string[]; ready: boolean };

export type SessionDto = {
  id: string;
  status: "ACTIVE" | "CREATED" | "ABANDONED";
  language: LanguagePreference;
  revision: number;
  propertyId: string | null;
  stage: IntakeState["stage"];
  muted: boolean;
  photosLater: boolean;
  lang: Lang;
  turns: Turn[];
  pending: Array<{ key: string; label: string; proposed: string; current: string | null; reason: "conflict" | "unverified" }>;
  asked: { key: string; label: string; kind: string; options?: Array<{ value: string; label: string }> } | null;
  review: Review;
  fields: Record<string, { value: Value; origin: Origin; confirmed: boolean }>;
  /** Every field that applies right now, with how to edit it by touch. */
  catalog: Array<{ key: string; label: string; kind: string; unit?: string; options?: Array<{ value: string; label: string }> }>;
};

// --- Field sets ---------------------------------------------------------------

const ALL_SPECS: FieldSpec[] = (() => {
  const seen = new Map<string, FieldSpec>();
  for (const [listing] of LISTING_TYPES) for (const [type] of PROPERTY_TYPES) for (const s of allowedFields(listing, type)) if (!seen.has(s.key)) seen.set(s.key, s);
  return [...seen.values()];
})();

function stated(state: IntakeState, key: string): string | undefined {
  const v = state.fields[key]?.value;
  return typeof v === "string" ? v : undefined;
}

/**
 * The fields that apply to what the agent has said so far. Until the property
 * type is known everything is acceptable (an agent often gives price and size
 * before the type); once it is known only that type's fields remain, and
 * anything captured earlier that no longer applies is shown as ignored.
 */
export function specsFor(state: IntakeState): FieldSpec[] {
  const type = stated(state, "propertyType");
  return type ? allowedFields(stated(state, "listingType") ?? "SALE", type) : ALL_SPECS;
}

// --- Review -------------------------------------------------------------------

function displayOf(spec: FieldSpec, value: Value, lang: Lang): string {
  return valueText(spec, value, lang);
}

export function buildPayload(state: IntakeState, specs: FieldSpec[]): { payload: Record<string, unknown>; excluded: string[] } {
  const payload: Record<string, unknown> = { status: "DRAFT", publishedOnWebsite: false, featured: false };
  const details: Record<string, unknown> = {};
  const excluded: string[] = [];
  for (const spec of specs) {
    const entry = state.fields[spec.key];
    if (!entry) continue;
    if (!entry.confirmed) {
      excluded.push(spec.key);
      continue;
    }
    if (spec.where === "detail") details[spec.key] = entry.value;
    else payload[spec.key] = entry.value;
  }
  payload.details = details;
  return { payload, excluded };
}

export function buildReview(state: IntakeState, lang: Lang): Review {
  const specs = specsFor(state);
  const rows: ReviewRow[] = [];
  const ignored: string[] = [];
  for (const [key, entry] of Object.entries(state.fields)) {
    const spec = specByKey(specs, key);
    if (!spec) {
      const any = ALL_SPECS.find((s) => s.key === key);
      if (any) ignored.push(label(any, lang));
      continue;
    }
    rows.push({
      key, label: label(spec, lang), display: displayOf(spec, entry.value, lang), origin: entry.origin, confirmed: entry.confirmed,
      needsConfirmation: !entry.confirmed,
    });
  }
  const { payload, excluded } = buildPayload(state, specs);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const el = lang === "el";
  if (!stated(state, "listingType") || !stated(state, "propertyType")) blockers.push(el ? "Δηλώστε είδος αγγελίας και τύπο ακινήτου." : "State the listing type and the property type.");
  for (const key of ["titleEl", "descriptionEl"] as const) {
    const e = state.fields[key];
    if (e && !e.confirmed) blockers.push(el ? `Επιβεβαιώστε: ${specByKey(specs, key) ? label(specByKey(specs, key)!, lang) : key}.` : `Confirm: ${key === "titleEl" ? "title" : "description"}.`);
  }
  const parsed = propertyUpsertSchema.safeParse({ listingType: "SALE", propertyType: "OTHER", ...payload });
  if (!parsed.success && state.fields.listingType && state.fields.propertyType) {
    for (const issue of parsed.error.issues) blockers.push(issue.message);
  }
  const normalized = normalizeForProfile({ ...payload, listingType: payload.listingType ?? "SALE", propertyType: payload.propertyType ?? "OTHER" }).values;
  for (const issue of requiredIssues({ ...normalized, status: "ACTIVE" })) warnings.push(el ? `Πριν την ενεργοποίηση: ${issue.message}` : `Before activation: ${issue.message}`);
  for (const key of excluded) {
    const spec = specByKey(specs, key);
    if (spec && key !== "titleEl" && key !== "descriptionEl") warnings.push(el ? `Δεν θα αποθηκευτεί μέχρι να επιβεβαιωθεί: ${label(spec, lang)}.` : `Not saved until confirmed: ${label(spec, lang)}.`);
  }
  const missing = completeness({ ...normalized, titleEl: payload.titleEl, descriptionEl: payload.descriptionEl }).missing;
  return { rows, blockers: [...new Set(blockers)], warnings, missing, ignored, ready: blockers.length === 0 && Boolean(state.fields.listingType && state.fields.propertyType) };
}

// --- DTO ----------------------------------------------------------------------

type Row = { id: string; status: "ACTIVE" | "CREATED" | "ABANDONED"; language: string; state: Prisma.JsonValue; turns: Prisma.JsonValue; revision: number; propertyId: string | null };

function turnsOf(raw: Prisma.JsonValue): Turn[] {
  return Array.isArray(raw) ? (raw as unknown as Turn[]).filter((t) => t && typeof t.text === "string").slice(-MAX_TURNS) : [];
}

export function toDto(row: Row): SessionDto {
  const state = readState(row.state);
  const pref = row.language === "el" || row.language === "en" ? row.language : "auto";
  const lang = pref === "auto" ? state.lang : pref;
  const specs = specsFor(state);
  const ui: Lang = "el"; // the CRM screen is Greek; only the assistant's replies follow the conversation language
  const asked = state.asked ? (specByKey(specs, state.asked) ?? ALL_SPECS.find((s) => s.key === state.asked)) : undefined;
  return {
    id: row.id,
    status: row.status,
    language: pref,
    revision: row.revision,
    propertyId: row.propertyId,
    stage: state.stage,
    muted: state.muted,
    photosLater: state.photosLater,
    lang,
    turns: turnsOf(row.turns),
    pending: state.pending.map((p) => {
      const spec = ALL_SPECS.find((s) => s.key === p.key);
      return {
        key: p.key,
        label: spec ? label(spec, ui) : p.key,
        proposed: spec ? valueText(spec, p.proposed, ui) : String(p.proposed),
        current: p.current === undefined ? null : spec ? valueText(spec, p.current, ui) : String(p.current),
        reason: p.reason,
      };
    }),
    asked: asked
      ? { key: asked.key, label: label(asked, ui), kind: asked.kind, options: asked.options?.map((o) => ({ value: o.value, label: o.labelEl })) }
      : null,
    review: buildReview(state, ui),
    fields: Object.fromEntries(Object.entries(state.fields).map(([k, e]) => [k, { value: e.value, origin: e.origin, confirmed: e.confirmed }])),
    catalog: specs.map((s) => ({
      key: s.key, label: label(s, ui), kind: s.kind, unit: s.unit,
      options: s.options?.map((o) => ({ value: o.value, label: o.labelEl })),
    })),
  };
}

// --- Persistence --------------------------------------------------------------

async function loadOwn(db: Db, userId: string, id: string): Promise<Row> {
  const row = await db.propertyIntakeSession.findFirst({ where: { id, userId } });
  if (!row) throw notFound("Η συνεδρία δεν βρέθηκε.");
  return row;
}

async function save(db: Db, row: Row, patch: { state?: IntakeState; turns?: Turn[]; language?: LanguagePreference; status?: "ACTIVE" | "CREATED" | "ABANDONED" }): Promise<Row> {
  const data: Prisma.PropertyIntakeSessionUpdateManyMutationInput = { revision: { increment: 1 } };
  if (patch.state) data.state = patch.state as unknown as Prisma.InputJsonValue;
  if (patch.turns) data.turns = patch.turns.slice(-MAX_TURNS) as unknown as Prisma.InputJsonValue;
  if (patch.language) data.language = patch.language;
  if (patch.status) data.status = patch.status;
  const res = await db.propertyIntakeSession.updateMany({ where: { id: row.id, revision: row.revision, status: "ACTIVE" }, data });
  if (res.count !== 1) throw new HttpError(409, "intake_conflict", "Η συνεδρία άλλαξε σε άλλη συσκευή ή έχει ολοκληρωθεί. Ανανεώστε και δοκιμάστε ξανά.");
  return db.propertyIntakeSession.findUniqueOrThrow({ where: { id: row.id } });
}

export async function startSession(db: Db, userId: string, language: LanguagePreference, meta: CreateMeta): Promise<SessionDto> {
  const state = emptyState();
  const lang: Lang = language === "en" ? "en" : "el";
  state.lang = lang;
  const turns: Turn[] = [{ role: "assistant", text: reply("greeting", lang), at: new Date().toISOString(), lang }];
  const row = await db.propertyIntakeSession.create({ data: { userId, language, state: state as unknown as Prisma.InputJsonValue, turns: turns as unknown as Prisma.InputJsonValue } });
  await writeAudit({ entity: "PROPERTY_INTAKE", entityId: row.id, action: "session_start", actorId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent, changes: { language } });
  return toDto(row);
}

export async function getSession(db: Db, userId: string, id: string): Promise<SessionDto> {
  return toDto(await loadOwn(db, userId, id));
}

export async function listResumable(db: Db, userId: string) {
  const rows = await db.propertyIntakeSession.findMany({ where: { userId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: 10 });
  return rows.map((r) => {
    const s = readState(r.state);
    const type = PROPERTY_TYPES.find(([v]) => v === stated(s, "propertyType"));
    const place = [stated(s, "areaName"), stated(s, "city")].filter(Boolean).join(", ");
    return { id: r.id, updatedAt: r.updatedAt, fieldCount: Object.keys(s.fields).length, summary: [type?.[1], place].filter(Boolean).join(" · ") || null };
  });
}

export async function abandonSession(db: Db, userId: string, id: string, meta: CreateMeta): Promise<SessionDto> {
  const row = await loadOwn(db, userId, id);
  if (row.status !== "ACTIVE") return toDto(row);
  const next = await save(db, row, { status: "ABANDONED" });
  await writeAudit({ entity: "PROPERTY_INTAKE", entityId: id, action: "session_abandon", actorId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
  return toDto(next);
}

// --- Speech -------------------------------------------------------------------

const AUDIO_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/flac", "audio/aac", "audio/aiff", "audio/webm", "audio/mp4"]);

export function normalizeAudioType(mime: string): string | null {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  return AUDIO_TYPES.has(base) ? (base === "audio/x-wav" ? "audio/wav" : base) : null;
}

export async function transcribe(ai: IntakeAiPort, input: { audio: Buffer; mimeType: string; preference: LanguagePreference }) {
  const timeout = AbortSignal.timeout(intakeAiConfig().timeoutMs);
  return ai.transcribe(input, timeout);
}

// --- A turn -------------------------------------------------------------------

export type TurnResult = { session: SessionDto; reply: string; changed: boolean };

export async function takeTurn(db: Db, ai: IntakeAiPort, userId: string, id: string, input: { text: string; detectedLanguage?: Lang | null; revision?: number }): Promise<TurnResult> {
  const cfg = intakeAiConfig();
  const row = await loadOwn(db, userId, id);
  if (row.status !== "ACTIVE") throw new HttpError(409, "intake_closed", "Η συνεδρία έχει ολοκληρωθεί.");
  if (input.revision !== undefined && input.revision !== row.revision) throw new HttpError(409, "intake_conflict", "Η συνεδρία άλλαξε σε άλλη συσκευή. Ανανεώστε και δοκιμάστε ξανά.");

  const text = input.text.trim().slice(0, cfg.maxUtteranceChars);
  if (!text) throw new HttpError(422, "empty_utterance", "Δεν υπάρχει κείμενο.");

  const pref: LanguagePreference = row.language === "el" || row.language === "en" ? row.language : "auto";
  let state = readState(row.state);
  const turns = turnsOf(row.turns);
  const now = new Date();

  const specsForAi = specsFor(state);
  let extraction;
  try {
    const raw = await ai.extract(
      {
        system: extractionSystemPrompt(specsForAi),
        user: extractionUserPrompt({ utterance: text, state, specs: specsForAi, expectedKey: state.asked, history: turns.map((t) => ({ role: t.role, text: t.text })) }),
        schema: extractionJsonSchema(specsForAi.map((s) => s.key)),
      },
      AbortSignal.timeout(cfg.timeoutMs),
    );
    extraction = parseExtraction(raw, new Set(ALL_SPECS.map((s) => s.key)));
  } catch (error) {
    if (error instanceof IntakeAiError) throw error;
    throw new IntakeAiError("provider", error);
  }

  const lang = pickLanguage(pref, extraction.language ?? input.detectedLanguage ?? null, state.lang);
  state.lang = pickLanguage("auto", extraction.language ?? input.detectedLanguage ?? null, state.lang);

  // 1) The two facts everything else depends on, then the rest against the fields that now apply.
  const rootKeys = new Set(ROOT_SPECS.map((s) => s.key));
  const first = applyProposals(state, extraction.proposals.filter((p) => rootKeys.has(p.key)), text, ROOT_SPECS, now);
  state = first.state;
  const second = applyProposals(state, extraction.proposals.filter((p) => !rootKeys.has(p.key)), text, specsFor(state), now);
  state = second.state;
  const applied = [...first.applied, ...second.applied];
  const notes: string[] = [];
  let newPref = pref;
  let changed = applied.length > 0 || first.pending.length + second.pending.length > 0;

  // 2) Commands and statements of "I don't know".
  for (const cmd of extraction.commands) {
    const specs = specsFor(state);
    switch (cmd.type) {
      case "accept":
      case "decline": {
        const key = cmd.key && state.pending.some((p) => p.key === cmd.key) ? cmd.key : state.pending[0]?.key;
        if (key) {
          const spec = ALL_SPECS.find((s) => s.key === key);
          const proposed = state.pending.find((p) => p.key === key)?.proposed;
          state = resolvePending(state, key, cmd.type === "accept");
          if (cmd.type === "accept" && spec && proposed !== undefined) applied.push({ key, value: proposed });
          changed = true;
        }
        break;
      }
      case "skip": {
        const key = cmd.key && ALL_SPECS.some((s) => s.key === cmd.key) ? cmd.key : state.asked;
        const spec = key ? ALL_SPECS.find((s) => s.key === key) : undefined;
        if (key && spec) {
          state = skipField(state, key);
          notes.push(skippedNote(spec, lang));
          changed = true;
        }
        break;
      }
      case "back": {
        const undone = undoLast(state);
        state = undone.state;
        notes.push(reply(undone.key ? "undone" : "nothingToUndo", lang));
        changed = changed || Boolean(undone.key);
        break;
      }
      case "photos_later":
        state = { ...state, photosLater: true };
        notes.push(reply("photosLater", lang));
        changed = true;
        break;
      case "mute":
      case "unmute":
        state = { ...state, muted: cmd.type === "mute" };
        notes.push(reply(cmd.type === "mute" ? "muted" : "unmuted", lang));
        changed = true;
        break;
      case "language":
        if (cmd.key === "el" || cmd.key === "en" || cmd.key === "auto") {
          newPref = cmd.key;
          notes.push(cmd.key === "en" ? reply("languageSet", "en") : cmd.key === "el" ? reply("languageSet", "el") : "");
          changed = true;
        }
        break;
      case "review":
        state = { ...state, stage: "review" };
        changed = true;
        break;
      case "show_missing": {
        const missing = buildReview(state, lang).missing;
        notes.push(`${reply("missingIntro", lang)} ${missing.length ? missing.join(", ") + "." : reply("nothingMissing", lang)}`);
        break;
      }
      default:
        void specs;
    }
  }
  for (const key of extraction.unknownKeys) {
    const spec = ALL_SPECS.find((s) => s.key === key);
    if (spec && !state.fields[key]) {
      state = skipField(state, key);
      notes.push(skippedNote(spec, lang));
      changed = true;
    }
  }
  for (const key of extraction.clear) {
    if (state.fields[key]) {
      state = clearField(state, key);
      changed = true;
    }
  }

  // 3) Say what was understood, then ask the next thing.
  const specsNow = specsFor(state);
  const ack = acknowledge(applied, ALL_SPECS, lang);
  const step = state.stage === "review" ? ({ type: "review" } as const) : nextStep(state, specsNow, questionOrder(stated(state, "listingType"), stated(state, "propertyType")));
  let ask: string | null = null;
  if (step.type === "confirm") {
    const spec = ALL_SPECS.find((s) => s.key === step.pending.key);
    ask = spec ? confirmQuestion(step.pending, spec, lang) : null;
    state.asked = step.pending.key;
  } else if (step.type === "ask") {
    const spec = specByKey(specsNow, step.key)!;
    ask = questionFor(spec, lang);
    state.asked = step.key;
  } else {
    state.asked = null;
    state.stage = "review";
    ask = reply("review", lang);
  }
  const nothing = !changed && notes.length === 0 ? reply("noChange", lang) : null;
  const message = composeReply([ack, ...notes, nothing, ask]);

  turns.push({ role: "agent", text, at: now.toISOString(), lang });
  turns.push({ role: "assistant", text: message, at: now.toISOString(), lang });
  const saved = await save(db, row, { state, turns, language: newPref !== pref ? newPref : undefined });
  return { session: toDto(saved), reply: message, changed };
}

// --- Touch edits --------------------------------------------------------------

export type Edit =
  | { type: "set"; key: string; value: unknown }
  | { type: "clear"; key: string }
  | { type: "confirm"; key: string }
  | { type: "resolve"; key: string; accept: boolean }
  | { type: "skip"; key: string }
  | { type: "undo" }
  | { type: "settings"; muted?: boolean; photosLater?: boolean; language?: LanguagePreference; stage?: "collect" | "review" };

export async function applyEdit(db: Db, userId: string, id: string, edit: Edit, revision?: number): Promise<SessionDto> {
  const row = await loadOwn(db, userId, id);
  if (row.status !== "ACTIVE") throw new HttpError(409, "intake_closed", "Η συνεδρία έχει ολοκληρωθεί.");
  if (revision !== undefined && revision !== row.revision) throw new HttpError(409, "intake_conflict", "Η συνεδρία άλλαξε σε άλλη συσκευή. Ανανεώστε και δοκιμάστε ξανά.");
  let state = readState(row.state);
  let language: LanguagePreference | undefined;
  switch (edit.type) {
    case "set": {
      const out = setManual(state, edit.key, edit.value, specsFor(state));
      if (out.error) throw new HttpError(422, "invalid_field", "Μη έγκυρη τιμή για αυτό το πεδίο.", { [edit.key]: [out.error] });
      state = out.state;
      break;
    }
    case "clear": state = clearField(state, edit.key); break;
    case "confirm": state = confirmField(state, edit.key); break;
    case "resolve": state = resolvePending(state, edit.key, edit.accept); break;
    case "skip": state = skipField(state, edit.key); break;
    case "undo": state = undoLast(state).state; break;
    case "settings":
      if (edit.muted !== undefined) state = { ...state, muted: edit.muted };
      if (edit.photosLater !== undefined) state = { ...state, photosLater: edit.photosLater };
      if (edit.stage) state = { ...state, stage: edit.stage };
      language = edit.language;
      break;
  }
  return toDto(await save(db, row, { state, language }));
}

// --- Suggested title and description -----------------------------------------

const digits = (s: string) => s.match(/\d+/g) ?? [];

/**
 * Drafts the listing title (deterministic) and descriptions (model) from the
 * agent's own confirmed facts. All of it arrives UNCONFIRMED: the agent must
 * accept or edit it before it can be saved. A description that mentions a
 * number that is not among the facts is discarded.
 */
export async function suggestTexts(db: Db, ai: IntakeAiPort | null, userId: string, id: string): Promise<SessionDto> {
  const row = await loadOwn(db, userId, id);
  if (row.status !== "ACTIVE") throw new HttpError(409, "intake_closed", "Η συνεδρία έχει ολοκληρωθεί.");
  let state = readState(row.state);
  const specs = specsFor(state);
  const typeRow = PROPERTY_TYPES.find(([v]) => v === stated(state, "propertyType"));
  if (!typeRow) throw new HttpError(422, "type_missing", "Δηλώστε πρώτα τον τύπο ακινήτου.");
  const area = state.fields.area?.value;
  const place = stated(state, "areaName") ?? stated(state, "city");
  const listing = stated(state, "listingType");
  const verbEl = listing === "RENT" ? "προς ενοικίαση" : listing === "SALE" ? "προς πώληση" : "";
  const verbEn = listing === "RENT" ? "for rent" : listing === "SALE" ? "for sale" : "";
  const titleEl = [typeRow[1], typeof area === "number" ? `${area} τ.μ.` : null, place ? `${place}` : null, verbEl].filter(Boolean).join(", ").replace(/, (προς)/, " $1");
  const titleEn = [typeRow[2], typeof area === "number" ? `${area} sqm` : null, place ? `in ${place}` : null, verbEn].filter(Boolean).join(" ");
  state = setDerived(state, "titleEl", titleEl, "SYSTEM_DERIVED");
  state = setDerived(state, "titleEn", titleEn, "SYSTEM_DERIVED");

  const facts = specs
    .filter((s) => !["titleEl", "titleEn", "descriptionEl", "descriptionEn"].includes(s.key))
    .flatMap((s) => {
      const e = state.fields[s.key];
      return e && e.confirmed ? [{ label: s.labelEn, value: valueText(s, e.value, "en") }] : [];
    });
  if (ai && facts.length >= 2) {
    try {
      const out = await ai.suggestTexts({ facts }, AbortSignal.timeout(intakeAiConfig().timeoutMs));
      const allowedNumbers = new Set(facts.flatMap((f) => digits(f.value)));
      for (const [key, value] of [["descriptionEl", out.descriptionEl], ["descriptionEn", out.descriptionEn]] as const) {
        if (value && digits(value).every((d) => allowedNumbers.has(d))) state = setDerived(state, key, value, "AI_SUGGESTED");
      }
    } catch (error) {
      if (!(error instanceof IntakeAiError)) throw error;
      // Text generation is optional: the agent can write the description or retry.
    }
  }
  return toDto(await save(db, row, { state }));
}

// --- Creation -----------------------------------------------------------------

export type CreatedProperty = { session: SessionDto; property: { id: string; reference: string }; alreadyCreated: boolean };

/**
 * Creates the property once. A retry (double tap, lost response, second
 * device) returns the same property: the session row is claimed inside the same
 * transaction that creates it, and `propertyId` is unique.
 */
export async function createProperty(db: Db, userId: string, id: string, meta: CreateMeta, revision?: number): Promise<CreatedProperty> {
  const existing = await loadOwn(db, userId, id);
  if (existing.propertyId) {
    const p = await db.property.findUniqueOrThrow({ where: { id: existing.propertyId }, select: { id: true, reference: true } });
    return { session: toDto(existing), property: p, alreadyCreated: true };
  }
  if (existing.status !== "ACTIVE") throw new HttpError(409, "intake_closed", "Η συνεδρία έχει ολοκληρωθεί.");
  if (revision !== undefined && revision !== existing.revision) throw new HttpError(409, "intake_conflict", "Η συνεδρία άλλαξε σε άλλη συσκευή. Ανανεώστε και δοκιμάστε ξανά.");

  const state = readState(existing.state);
  const specs = specsFor(state);
  const review = buildReview(state, "el");
  if (!review.ready) throw new HttpError(422, "intake_not_ready", "Η καταχώριση δεν είναι έτοιμη.", { review: review.blockers });
  const { payload } = buildPayload(state, specs);
  const parsed = propertyUpsertSchema.parse({ ...payload, agentId: userId });

  try {
    const created = await db.$transaction(
      async (tx) => {
        const claim = await tx.propertyIntakeSession.updateMany({ where: { id, userId, status: "ACTIVE", propertyId: null }, data: { status: "CREATED", revision: { increment: 1 } } });
        if (claim.count !== 1) throw new HttpError(409, "intake_conflict", "Η συνεδρία ολοκληρώθηκε ήδη.");
        const property = await createPropertyInTx(tx, { id: userId }, parsed, meta);
        await tx.propertyIntakeSession.update({ where: { id }, data: { propertyId: property.id } });
        const origins = Object.values(state.fields).reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.origin]: (acc[e.origin] ?? 0) + 1 }), {});
        await writeAudit({ entity: "PROPERTY_INTAKE", entityId: id, action: "property_create", actorId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent, changes: { propertyId: property.id, reference: property.reference, fields: Object.keys(state.fields).length, origins } }, tx);
        return property;
      },
      { isolationLevel: "Serializable" },
    );
    const row = await db.propertyIntakeSession.findUniqueOrThrow({ where: { id } });
    return { session: toDto(row), property: { id: created.id, reference: created.reference }, alreadyCreated: false };
  } catch (error) {
    // A concurrent retry won the race: hand back what it created.
    const again = await db.propertyIntakeSession.findFirst({ where: { id, userId } });
    if (again?.propertyId) {
      const p = await db.property.findUniqueOrThrow({ where: { id: again.propertyId }, select: { id: true, reference: true } });
      return { session: toDto(again), property: p, alreadyCreated: true };
    }
    throw error;
  }
}

/** The last assistant message, which is the only text the speech endpoint will speak. */
export async function lastAssistantText(db: Db, userId: string, id: string): Promise<{ text: string; lang: Lang; muted: boolean }> {
  const row = await loadOwn(db, userId, id);
  const state = readState(row.state);
  const last = [...turnsOf(row.turns)].reverse().find((t) => t.role === "assistant");
  if (!last) throw new HttpError(404, "no_reply", "Δεν υπάρχει απάντηση για εκφώνηση.");
  return { text: last.text, lang: last.lang ?? state.lang, muted: state.muted };
}
