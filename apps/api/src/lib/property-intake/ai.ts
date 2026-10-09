/**
 * The one place this feature talks to Gemini.
 *
 * Everything else depends on `IntakeAiPort`, so the conversation logic is
 * tested with a scripted port and the real SDK runs only against a configured
 * server. Credentials stay here: the browser never sees a key, and error
 * messages never carry provider text.
 */

import { AudioTranscriptionConfigMode, GoogleGenAI } from "@google/genai";

import { intakeAiConfig, type IntakeAiConfig } from "./config";
import { SUGGEST_SYSTEM } from "./extraction";
import { LABEL_SYSTEM, labelJsonSchema } from "./photo-labels";
import { detectLanguage, intakeVocabulary, LANGUAGE_CODES, routeFor, transcriptionPrompt } from "./transcription";
import type { Lang } from "./state";

export type IntakeFailure = "not_configured" | "timeout" | "provider" | "empty" | "invalid";

/** Any failure of the AI side. The cause is kept for the server log only. */
export class IntakeAiError extends Error {
  constructor(readonly category: IntakeFailure, cause?: unknown) {
    super(`Property intake AI failed (${category}).`);
    this.name = "IntakeAiError";
    if (cause !== undefined) this.cause = cause;
  }
}

export type LanguagePreference = "auto" | Lang;

export type SuggestedTexts = { titleEl?: string; titleEn?: string; descriptionEl?: string; descriptionEn?: string };

export interface IntakeAiPort {
  /** Speech to text. `language` is null when the model could not tell. */
  transcribe(input: { audio: Buffer; mimeType: string; preference: LanguagePreference }, signal: AbortSignal): Promise<{ text: string; language: Lang | null }>;
  /** Runs an extraction request and returns the model's raw JSON (validated by the caller). */
  extract(input: { system: string; user: string; schema: Record<string, unknown> }, signal: AbortSignal): Promise<unknown>;
  /** Greek and English title/description drafted from confirmed facts only. */
  suggestTexts(input: { facts: Array<{ label: string; value: string }> }, signal: AbortSignal): Promise<SuggestedTexts>;
  /** Looks at small previews and returns the model's raw JSON of room labels (validated by the caller). */
  labelPhotos(input: { images: Array<{ id: string; mimeType: string; data: Buffer }> }, signal: AbortSignal): Promise<unknown>;
  /** Text to speech: a playable WAV. */
  speak(input: { text: string; lang: Lang }, signal: AbortSignal): Promise<{ wav: Buffer; sampleRate: number }>;
}

const SPEECH_SAMPLE_RATE = 24_000;

/** Wraps raw 16-bit mono PCM (what Gemini TTS returns) in a WAV header so every browser can play it. */
export function pcmToWav(pcm: Buffer, sampleRate: number = SPEECH_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function statusOf(cause: unknown): number | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const r = cause as { status?: unknown; code?: unknown };
  for (const v of [r.status, r.code]) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

/** Throttling and 5xx are worth one retry; a bad key, model or request is not. */
export function isTransient(cause: unknown): boolean {
  const status = statusOf(cause);
  return status === undefined ? true : status === 429 || (status >= 500 && status <= 504);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withRetry<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const retry = error instanceof IntakeAiError && error.category === "provider" && !signal.aborted && isTransient(error.cause);
      if (!retry || attempt >= 2) throw error;
      await sleep(250 * attempt);
    }
  }
}

function fail(signal: AbortSignal, error: unknown): never {
  throw new IntakeAiError(signal.aborted ? "timeout" : "provider", error);
}

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new IntakeAiError("invalid");
  }
}

/** A refusal that a different model may not share: unknown model id, or an option this model does not support. */
function isModelRefusal(error: unknown): boolean {
  if (!(error instanceof IntakeAiError) || error.category !== "provider") return false;
  const status = statusOf(error.cause);
  return status === 400 || status === 404;
}

export function createGeminiIntakeAi(config: Pick<IntakeAiConfig, "apiKey" | "transcribeModel" | "transcribeMode" | "fallbackModel" | "extractModel" | "ttsModel" | "ttsVoice">): IntakeAiPort {
  if (!config.apiKey) throw new IntakeAiError("not_configured");
  const client = new GoogleGenAI({ apiKey: config.apiKey });

  async function text(model: string, signal: AbortSignal, request: Parameters<typeof client.models.generateContent>[0]["contents"], system: string | undefined, schema: unknown, maxOutputTokens: number): Promise<string> {
    return withRetry(signal, async () => {
      let response;
      try {
        response = await client.models.generateContent({
          model,
          contents: request,
          config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0, maxOutputTokens, abortSignal: signal },
        });
      } catch (error) {
        return fail(signal, error);
      }
      const out = (response.candidates?.[0]?.content?.parts ?? []).flatMap((p) => (typeof p.text === "string" && !p.thought ? [p.text] : [])).join("").trim();
      if (!out) throw new IntakeAiError("empty");
      return out;
    });
  }

  return {
    async transcribe({ audio, mimeType, preference }, signal) {
      const vocabulary = intakeVocabulary();
      const audioPart = { inlineData: { mimeType, data: audio.toString("base64") } };

      /** Dedicated recogniser: the SDK's audioTranscriptionConfig with BCP-47 codes and the vocabulary. Plain text out. */
      const viaAsr = async (model: string) =>
        withRetry(signal, async () => {
          let response;
          try {
            response = await client.models.generateContent({
              model,
              contents: [{ role: "user", parts: [audioPart] }],
              config: {
                audioTranscriptionConfig: { languageCodes: LANGUAGE_CODES[preference], customVocabulary: vocabulary, mode: AudioTranscriptionConfigMode.VERBATIM },
                temperature: 0,
                abortSignal: signal,
              },
            });
          } catch (error) {
            return fail(signal, error);
          }
          const spoken = (response.candidates?.[0]?.content?.parts ?? []).flatMap((p) => (typeof p.text === "string" && !p.thought ? [p.text] : [])).join(" ").trim();
          if (!spoken) throw new IntakeAiError("empty");
          return { text: spoken, language: detectLanguage(spoken) };
        });

      /** General model with an audio prompt: works on any Flash model. */
      const viaPrompt = async (model: string) => {
        const raw = await text(
          model,
          signal,
          [{ role: "user", parts: [audioPart, { text: transcriptionPrompt(preference, vocabulary) }] }],
          undefined,
          { type: "object", properties: { text: { type: "string" }, language: { type: "string", enum: ["el", "en"] } }, required: ["text", "language"] },
          2000,
        );
        const parsed = jsonOf(raw) as { text?: unknown; language?: unknown };
        const spoken = typeof parsed.text === "string" ? parsed.text.trim() : "";
        if (!spoken) throw new IntakeAiError("empty");
        return { text: spoken, language: parsed.language === "el" || parsed.language === "en" ? parsed.language : detectLanguage(spoken) };
      };

      const primary = routeFor(config.transcribeMode, config.transcribeModel) === "asr" ? () => viaAsr(config.transcribeModel) : () => viaPrompt(config.transcribeModel);
      try {
        return await primary();
      } catch (error) {
        // An unknown model id or an unsupported option is a configuration problem, not the agent's: use the
        // text model the rest of the assistant already runs on, rather than failing the recording.
        if (isModelRefusal(error) && config.fallbackModel !== config.transcribeModel) return viaPrompt(config.fallbackModel);
        throw error;
      }
    },

    async extract({ system, user, schema }, signal) {
      return jsonOf(await text(config.extractModel, signal, [{ role: "user", parts: [{ text: user }] }], system, schema, 1500));
    },

    async suggestTexts({ facts }, signal) {
      const raw = await text(
        config.extractModel,
        signal,
        [{ role: "user", parts: [{ text: `Facts:\n${facts.map((f) => `- ${f.label}: ${f.value}`).join("\n")}` }] }],
        SUGGEST_SYSTEM,
        {
          type: "object",
          properties: { titleEl: { type: "string" }, titleEn: { type: "string" }, descriptionEl: { type: "string" }, descriptionEn: { type: "string" } },
          required: ["titleEl", "titleEn", "descriptionEl", "descriptionEn"],
        },
        1200,
      );
      const p = jsonOf(raw) as Record<string, unknown>;
      const pick = (k: string, max: number) => (typeof p[k] === "string" && p[k]!.toString().trim() ? p[k]!.toString().trim().slice(0, max) : undefined);
      return { titleEl: pick("titleEl", 200), titleEn: pick("titleEn", 200), descriptionEl: pick("descriptionEl", 5000), descriptionEn: pick("descriptionEn", 5000) };
    },

    async labelPhotos({ images }, signal) {
      const parts = images.flatMap((img) => [{ text: `Image id: ${img.id}` }, { inlineData: { mimeType: img.mimeType, data: img.data.toString("base64") } }]);
      parts.push({ text: "Label each image. Reply as JSON." });
      return jsonOf(await text(config.extractModel, signal, [{ role: "user", parts }], LABEL_SYSTEM, labelJsonSchema(), 1500));
    },

    async speak({ text: spoken }, signal) {
      return withRetry(signal, async () => {
        let response;
        try {
          response = await client.models.generateContent({
            model: config.ttsModel,
            contents: [{ role: "user", parts: [{ text: spoken }] }],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.ttsVoice } } },
              abortSignal: signal,
            },
          });
        } catch (error) {
          return fail(signal, error);
        }
        const part = (response.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
        if (!part?.inlineData?.data) throw new IntakeAiError("empty");
        return { wav: pcmToWav(Buffer.from(part.inlineData.data, "base64")), sampleRate: SPEECH_SAMPLE_RATE };
      });
    },
  };
}

let override: IntakeAiPort | null | undefined;
let cached: { key: string; port: IntakeAiPort } | null = null;

/** Test seam: `null` restores the real provider. */
export function setIntakeAi(port: IntakeAiPort | null): void {
  override = port ?? undefined;
}

/** The provider for this process, or null when no key is configured. */
export function intakeAi(): IntakeAiPort | null {
  if (override) return override;
  const config = intakeAiConfig();
  if (!config.apiKey) return null;
  const signature = [config.apiKey.length, config.transcribeModel, config.transcribeMode, config.fallbackModel, config.extractModel, config.ttsModel, config.ttsVoice].join("|");
  if (!cached || cached.key !== signature) cached = { key: signature, port: createGeminiIntakeAi(config) };
  return cached.port;
}

export function intakeAiAvailable(): boolean {
  return Boolean(override) || Boolean(intakeAiConfig().apiKey);
}
