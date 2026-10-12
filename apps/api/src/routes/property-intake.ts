/**
 * Voice and text property intake.
 *
 * Every route belongs to the signed-in agent: a session is only ever loaded by
 * its owner. The AI side may be unavailable (no key, provider down); sessions,
 * touch edits, review and creation keep working without it, so an agent can
 * always finish by hand. Creation is a draft and never publishes.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { HttpError, tooManyRequests } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { db } from "../lib/prisma";
import { consume } from "../lib/rate-limit";
import { IntakeAiError, intakeAi, intakeAiAvailable } from "../lib/property-intake/ai";
import { sniffAudio } from "../lib/property-intake/audio";
import { CLIENT_REF } from "../lib/property-intake/state";
import { intakeAiConfig } from "../lib/property-intake/config";
import { createLiveToken, LIVE_AUDIO, LIVE_KICKOFF, LIVE_RESUME, liveConfig, liveSocketUrl, wireSetup } from "../lib/property-intake/live";
import { writeAudit } from "../lib/audit";
import { MAX_LABEL_IMAGE_BYTES, MAX_LABEL_IMAGES, parseLabels, sniffImage } from "../lib/property-intake/photo-labels";
import { imageDimensions } from "../lib/image-size";
import {
  abandonSession, applyEdit, createProperty, getSession, lastAssistantText, listResumable, liveSync, normalizeAudioType,
  prepareLive, searchOwnerCandidates, startSession, suggestTexts, takeTurn, transcribe, type Edit,
} from "../lib/property-intake/service";
import { requireRole } from "../plugins/auth";

const language = z.enum(["auto", "el", "en"]).default("auto");
const revision = z.number().int().min(0).optional();

const startSchema = z.object({ language: language.optional(), clientRef: z.string().regex(CLIENT_REF).optional() }).default({});
const turnSchema = z.object({ text: z.string().min(1).max(4000), detectedLanguage: z.enum(["el", "en"]).nullish(), revision });
const transcribeSchema = z.object({ audio: z.string().min(100).max(6_000_000), mimeType: z.string().max(100), language: language.optional() });
const editSchema = z.object({
  edit: z.discriminatedUnion("type", [
    z.object({ type: z.literal("set"), key: z.string().max(60), value: z.union([z.string().max(20000), z.number(), z.boolean()]) }),
    z.object({ type: z.literal("clear"), key: z.string().max(60) }),
    z.object({ type: z.literal("confirm"), key: z.string().max(60) }),
    z.object({ type: z.literal("resolve"), key: z.string().max(60), accept: z.boolean() }),
    z.object({ type: z.literal("skip"), key: z.string().max(60) }),
    z.object({ type: z.literal("undo") }),
    z.object({ type: z.literal("owner"), contactId: z.string().min(1).max(40).nullable() }),
    z.object({
      type: z.literal("location"),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      accuracy: z.number().min(0).max(100_000).nullish(),
      source: z.enum(["gps", "map", "manual"]).optional(),
      visibility: z.enum(["exact", "approximate", "private"]).optional(),
      clear: z.literal(true).optional(),
    }),
    z.object({ type: z.literal("settings"), muted: z.boolean().optional(), photosLater: z.boolean().optional(), language: language.optional(), stage: z.enum(["collect", "review"]).optional() }),
  ]),
  revision,
});
const labelSchema = z.object({
  images: z.array(z.object({ id: z.string().min(1).max(120), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().min(100).max(600_000) })).min(1).max(MAX_LABEL_IMAGES),
});
const revisionOnly = z.object({ revision }).default({});
/** A Live API session-resumption handle: an opaque token from Google, passed back as is. */
const liveTokenSchema = z.object({ resumeHandle: z.string().min(1).max(4096).regex(/^[A-Za-z0-9_\-./+=:]+$/).optional() }).default({});
const liveSyncSchema = z.object({
  lines: z.array(z.object({ role: z.enum(["agent", "assistant"]), text: z.string().max(4000) })).max(40).default([]),
  /** The live model's tool arguments, forwarded untouched: validated field by field on the server. */
  facts: z.record(z.unknown()).optional(),
});

/** A location edit either clears the point or gives all of it. */
function toEdit(edit: z.infer<typeof editSchema>["edit"]): Edit {
  if (edit.type !== "location") return edit;
  if (edit.clear) return { type: "location", clear: true };
  if (edit.lat === undefined || edit.lng === undefined || !edit.source || !edit.visibility) throw new HttpError(422, "invalid_location", "Λείπουν συντεταγμένες ή η ορατότητα της θέσης.");
  return { type: "location", lat: edit.lat, lng: edit.lng, accuracy: edit.accuracy ?? null, source: edit.source, visibility: edit.visibility };
}

const SPEECH_FAILURE = "Η φωνητική λειτουργία δεν είναι διαθέσιμη αυτή τη στιγμή. Συνεχίστε γράφοντας ή με τα πεδία.";

const AI_KEY = "Η υπηρεσία AI δεν δέχεται το κλειδί του server. Ενημερώστε τον διαχειριστή· μέχρι τότε συμπληρώστε τα στοιχεία στα «Βασικά στοιχεία».";
const AI_BUSY = "Η υπηρεσία AI έχει πολλά αιτήματα αυτή τη στιγμή. Δοκιμάστε ξανά σε ένα λεπτό· το κείμενό σας κρατήθηκε.";
const AI_BAD_ANSWER = "Ο βοηθός δεν έδωσε έγκυρη απάντηση αυτή τη φορά. Το κείμενό σας κρατήθηκε: πατήστε ξανά «Αποστολή στον βοηθό» ή συμπληρώστε τα στοιχεία στα «Βασικά στοιχεία».";
const LIVE_DOWN = "Η ζωντανή συνομιλία δεν είναι διαθέσιμη αυτή τη στιγμή. Συνεχίστε με ηχογράφηση ή πληκτρολόγηση· ό,τι έχει καταγραφεί κρατήθηκε.";
const AI_DOWN = "Η υπηρεσία AI δεν απάντησε. Το κείμενό σας κρατήθηκε: δοκιμάστε ξανά σε λίγο ή συμπληρώστε τα στοιχεία στα «Βασικά στοιχεία».";

function providerStatus(error: IntakeAiError): number | undefined {
  if (error.detail.status) return error.detail.status;
  const c = error.cause as { status?: unknown } | undefined;
  return typeof c?.status === "number" ? c.status : undefined;
}

/**
 * Provider trouble becomes a calm, safe message that says what the agent can do; the text they wrote stays in
 * the box (the screen only clears it after a successful send). Logged: the category, the provider's HTTP
 * status, the model id and the finish reason. Never the request, the transcript or the provider's words.
 */
function aiHttpError(error: unknown, log: (o: object, m: string) => void, op: string): never {
  if (error instanceof IntakeAiError) {
    const status = providerStatus(error);
    log({ op, category: error.category, status, model: error.detail.model, finishReason: error.detail.finishReason }, "property intake AI failure");
    if (error.category === "not_configured") throw new HttpError(503, "intake_ai_unavailable", SPEECH_FAILURE);
    if (error.category === "timeout") throw new HttpError(504, "intake_ai_timeout", "Η υπηρεσία άργησε να απαντήσει. Δοκιμάστε ξανά ή συνεχίστε γράφοντας.");
    if (error.category === "empty" && op === "transcribe") throw new HttpError(422, "no_speech", "Δεν ακούστηκε ομιλία. Δοκιμάστε ξανά ή γράψτε το μήνυμά σας.");
    if (op === "transcribe") throw new HttpError(502, "intake_ai_error", SPEECH_FAILURE);
    if (op === "live") {
      if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|API key not valid/i.test(error.cause instanceof Error ? error.cause.message : ""))) throw new HttpError(503, "intake_ai_key", AI_KEY);
      if (status === 429) throw new HttpError(503, "intake_ai_busy", AI_BUSY);
      throw new HttpError(502, "intake_live_unavailable", LIVE_DOWN);
    }
    if (error.category === "empty" || error.category === "invalid") throw new HttpError(502, "intake_ai_bad_answer", AI_BAD_ANSWER);
    if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|API key not valid/i.test(error.cause instanceof Error ? error.cause.message : ""))) throw new HttpError(503, "intake_ai_key", AI_KEY);
    if (status === 429) throw new HttpError(503, "intake_ai_busy", AI_BUSY);
    throw new HttpError(502, "intake_ai_error", AI_DOWN);
  }
  throw error;
}

function requireAi() {
  const ai = intakeAi();
  if (!ai) throw new HttpError(503, "intake_ai_unavailable", SPEECH_FAILURE);
  return ai;
}

export async function propertyIntakeRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };
  const meta = (request: Parameters<typeof clientIp>[0]) => ({ ipAddress: clientIp(request), userAgent: userAgent(request) });
  const limit = (userId: string, kind: "turn" | "transcribe" | "speak" | "photos" | "live" | "liveSync") => {
    const rule = intakeAiConfig().rate[kind];
    if (!consume(`intake:${kind}:${userId}`, rule).allowed) throw tooManyRequests("Πάρα πολλά αιτήματα. Περιμένετε λίγο και δοκιμάστε ξανά.");
  };

  app.get("/property-intake/status", agent, async () => {
    const cfg = intakeAiConfig();
    return { available: intakeAiAvailable(), maxAudioBytes: cfg.maxAudioBytes, maxUtteranceChars: cfg.maxUtteranceChars, live: { available: cfg.live.enabled, model: cfg.live.enabled ? cfg.live.model : null } };
  });

  /** Existing contacts matching a name, company, reference, phone or email the agent types. Names and the last four digits only. */
  app.get("/property-intake/contacts", agent, async (request) => {
    const { q } = parseInput(z.object({ q: z.string().max(120).default("") }), request.query);
    return { contacts: await searchOwnerCandidates(db(), q) };
  });

  app.get("/property-intake/sessions", agent, async (request) => ({ sessions: await listResumable(db(), request.auth!.user.id) }));

  app.post("/property-intake/sessions", agent, async (request, reply) => {
    const input = parseInput(startSchema, request.body ?? {});
    const session = await startSession(db(), request.auth!.user.id, input.language ?? "auto", meta(request), input.clientRef);
    reply.code(201);
    return { session };
  });

  app.get("/property-intake/sessions/:id", agent, async (request) => {
    const { id } = request.params as { id: string };
    return { session: await getSession(db(), request.auth!.user.id, id) };
  });

  app.post("/property-intake/sessions/:id/transcribe", { ...agent, bodyLimit: 5 * 1024 * 1024 }, async (request) => {
    const user = request.auth!.user;
    const { id } = request.params as { id: string };
    await getSession(db(), user.id, id);
    limit(user.id, "transcribe");
    const input = parseInput(transcribeSchema, request.body);
    const cfg = intakeAiConfig();
    const audio = Buffer.from(input.audio, "base64");
    if (audio.length === 0 || audio.length > cfg.maxAudioBytes) throw new HttpError(413, "audio_too_large", "Η ηχογράφηση είναι πολύ μεγάλη. Κρατήστε την κάτω από ένα λεπτό.");
    const declared = normalizeAudioType(input.mimeType);
    const actual = sniffAudio(audio);
    if (!declared || !actual) throw new HttpError(415, "audio_type", "Μη υποστηριζόμενος τύπος ήχου.");
    const ai = requireAi();
    try {
      // Nothing about the recording is stored or logged: it lives in memory for this request only.
      const result = await transcribe(ai, { audio, mimeType: actual, preference: input.language ?? "auto" });
      return { text: result.text, language: result.language };
    } catch (error) {
      return aiHttpError(error, (o, m) => request.log.warn(o, m), "transcribe");
    }
  });

  app.post("/property-intake/sessions/:id/turn", agent, async (request) => {
    const user = request.auth!.user;
    const { id } = request.params as { id: string };
    const input = parseInput(turnSchema, request.body);
    limit(user.id, "turn");
    const ai = requireAi();
    try {
      return await takeTurn(db(), ai, user.id, id, input);
    } catch (error) {
      return aiHttpError(error, (o, m) => request.log.warn(o, m), "turn");
    }
  });

  app.post("/property-intake/sessions/:id/edit", agent, async (request) => {
    const { id } = request.params as { id: string };
    const input = parseInput(editSchema, request.body);
    return { session: await applyEdit(db(), request.auth!.user.id, id, toEdit(input.edit), input.revision) };
  });

  app.post("/property-intake/sessions/:id/suggest", agent, async (request) => {
    const user = request.auth!.user;
    const { id } = request.params as { id: string };
    limit(user.id, "turn");
    try {
      return { session: await suggestTexts(db(), intakeAi(), user.id, id) };
    } catch (error) {
      return aiHttpError(error, (o, m) => request.log.warn(o, m), "suggest");
    }
  });

  /**
   * Suggests a room label for each small preview the browser sends. Previews are held in memory for this
   * request only. The suggestions change nothing: the agent accepts or edits them, and they become the
   * photos' alternative text only when saved with the property.
   */
  app.post("/property-intake/sessions/:id/label-photos", { ...agent, bodyLimit: 8 * 1024 * 1024 }, async (request) => {
    const user = request.auth!.user;
    const { id } = request.params as { id: string };
    await getSession(db(), user.id, id);
    limit(user.id, "photos");
    const input = parseInput(labelSchema, request.body);
    const ids = input.images.map((i) => i.id);
    if (new Set(ids).size !== ids.length) throw new HttpError(422, "duplicate_photo", "Υπάρχουν διπλές φωτογραφίες στο αίτημα.");
    const images = input.images.map((i) => {
      const data = Buffer.from(i.data, "base64");
      if (data.length === 0 || data.length > MAX_LABEL_IMAGE_BYTES || sniffImage(data) !== i.mimeType || !imageDimensions(data)) throw new HttpError(415, "photo_type", "Μία από τις φωτογραφίες δεν είναι έγκυρη εικόνα ή είναι πολύ μεγάλη.");
      return { id: i.id, mimeType: i.mimeType, data };
    });
    const ai = requireAi();
    try {
      const raw = await ai.labelPhotos({ images }, AbortSignal.timeout(intakeAiConfig().timeoutMs));
      return { labels: parseLabels(raw, ids) };
    } catch (error) {
      return aiHttpError(error, (o, m) => request.log.warn(o, m), "label-photos");
    }
  });

  /** Speaks the assistant's latest reply (and nothing else: the endpoint accepts no text). */
  app.post("/property-intake/sessions/:id/speak", agent, async (request) => {
    const user = request.auth!.user;
    const { id } = request.params as { id: string };
    const last = await lastAssistantText(db(), user.id, id);
    if (last.muted) return { audio: null, muted: true };
    limit(user.id, "speak");
    const ai = requireAi();
    try {
      const out = await ai.speak({ text: last.text, lang: last.lang }, AbortSignal.timeout(intakeAiConfig().timeoutMs));
      return { audio: out.wav.toString("base64"), mimeType: "audio/wav", sampleRate: out.sampleRate, muted: false };
    } catch (error) {
      return aiHttpError(error, (o, m) => request.log.warn(o, m), "speak");
    }
  });

  /**
   * Starts (or reconnects) a real-time conversation: a single-use token for Google's Live API, bound to this
   * session's instructions and tool and valid for a few minutes to connect. The permanent key never leaves the
   * server, and the token is never logged or stored.
   */
  app.post("/property-intake/sessions/:id/live/token", agent, async (request, reply) => {
    const user = request.auth!.user;
    const { id } = request.params as { id: string };
    const input = parseInput(liveTokenSchema, request.body ?? {});
    const prepared = await prepareLive(db(), user.id, id);
    const cfg = intakeAiConfig();
    if (!cfg.live.enabled) throw new HttpError(503, "intake_live_unavailable", LIVE_DOWN);
    limit(user.id, "live");
    const config = liveConfig({ cfg, system: prepared.system, keys: prepared.keys, resumeHandle: input.resumeHandle });
    try {
      const token = await createLiveToken(cfg, config, AbortSignal.timeout(Math.min(cfg.timeoutMs, 15_000)));
      await writeAudit({ entity: "PROPERTY_INTAKE", entityId: id, action: input.resumeHandle ? "live_resume" : "live_start", actorId: user.id, ipAddress: meta(request).ipAddress, userAgent: meta(request).userAgent, changes: { model: cfg.live.model } });
      reply.header("cache-control", "no-store");
      return {
        ...token,
        url: liveSocketUrl(),
        model: cfg.live.model,
        setup: wireSetup(cfg.live.model, config),
        kickoff: prepared.resumed || input.resumeHandle ? LIVE_RESUME : LIVE_KICKOFF,
        audio: LIVE_AUDIO,
      };
    } catch (error) {
      return aiHttpError(error, (o, m) => request.log.warn(o, m), "live");
    }
  });

  /** Transcript lines and the live model's reported facts. Validated like a typed turn; never creates a property. */
  app.post("/property-intake/sessions/:id/live/sync", agent, async (request) => {
    const user = request.auth!.user;
    const { id } = request.params as { id: string };
    const input = parseInput(liveSyncSchema, request.body ?? {});
    limit(user.id, "liveSync");
    return liveSync(db(), user.id, id, { lines: input.lines, facts: input.facts });
  });

  app.post("/property-intake/sessions/:id/create", agent, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parseInput(revisionOnly, request.body ?? {});
    const result = await createProperty(db(), request.auth!.user.id, id, meta(request), input.revision);
    reply.code(result.alreadyCreated ? 200 : 201);
    return result;
  });

  app.post("/property-intake/sessions/:id/abandon", agent, async (request) => {
    const { id } = request.params as { id: string };
    return { session: await abandonSession(db(), request.auth!.user.id, id, meta(request)) };
  });
}
