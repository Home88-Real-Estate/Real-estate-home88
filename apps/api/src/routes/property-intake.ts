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
import { intakeAiConfig } from "../lib/property-intake/config";
import {
  abandonSession, applyEdit, createProperty, getSession, lastAssistantText, listResumable, normalizeAudioType,
  startSession, suggestTexts, takeTurn, transcribe,
} from "../lib/property-intake/service";
import { requireRole } from "../plugins/auth";

const language = z.enum(["auto", "el", "en"]).default("auto");
const revision = z.number().int().min(0).optional();

const startSchema = z.object({ language: language.optional() }).default({});
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
    z.object({ type: z.literal("settings"), muted: z.boolean().optional(), photosLater: z.boolean().optional(), language: language.optional(), stage: z.enum(["collect", "review"]).optional() }),
  ]),
  revision,
});
const revisionOnly = z.object({ revision }).default({});

const SPEECH_FAILURE = "Η φωνητική λειτουργία δεν είναι διαθέσιμη αυτή τη στιγμή. Συνεχίστε γράφοντας ή με τα πεδία.";

/** Provider trouble becomes a calm, safe message; the category is logged, the provider's words never are. */
function aiHttpError(error: unknown, log: (o: object, m: string) => void, op: string): never {
  if (error instanceof IntakeAiError) {
    log({ op, category: error.category }, "property intake AI failure");
    if (error.category === "not_configured") throw new HttpError(503, "intake_ai_unavailable", SPEECH_FAILURE);
    if (error.category === "timeout") throw new HttpError(504, "intake_ai_timeout", "Η υπηρεσία άργησε να απαντήσει. Δοκιμάστε ξανά ή συνεχίστε γράφοντας.");
    if (error.category === "empty" && op === "transcribe") throw new HttpError(422, "no_speech", "Δεν ακούστηκε ομιλία. Δοκιμάστε ξανά ή γράψτε το μήνυμά σας.");
    throw new HttpError(502, "intake_ai_error", SPEECH_FAILURE);
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
  const limit = (userId: string, kind: "turn" | "transcribe" | "speak") => {
    const rule = intakeAiConfig().rate[kind];
    if (!consume(`intake:${kind}:${userId}`, rule).allowed) throw tooManyRequests("Πάρα πολλά αιτήματα. Περιμένετε λίγο και δοκιμάστε ξανά.");
  };

  app.get("/property-intake/status", agent, async () => {
    const cfg = intakeAiConfig();
    return { available: intakeAiAvailable(), maxAudioBytes: cfg.maxAudioBytes, maxUtteranceChars: cfg.maxUtteranceChars };
  });

  app.get("/property-intake/sessions", agent, async (request) => ({ sessions: await listResumable(db(), request.auth!.user.id) }));

  app.post("/property-intake/sessions", agent, async (request, reply) => {
    const input = parseInput(startSchema, request.body ?? {});
    const session = await startSession(db(), request.auth!.user.id, input.language ?? "auto", meta(request));
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
    return { session: await applyEdit(db(), request.auth!.user.id, id, input.edit, input.revision) };
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
