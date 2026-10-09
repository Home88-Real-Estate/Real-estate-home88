/**
 * Configuration of the property intake assistant. Server-only.
 *
 * GEMINI_API_KEY is read here and nowhere else in this feature: never logged,
 * never returned, never given a NEXT_PUBLIC_ spelling. The model ids are
 * configuration, not code, because Google renames and retires them; the
 * defaults are the ones the website assistant already runs in production
 * (text) and the one the installed SDK lists for speech (TTS). A dedicated
 * transcription model is NOT assumed: transcription is an audio prompt to a
 * normal Flash model, which is what the Gemini audio guide documents.
 */

export const DEFAULT_TEXT_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_TTS_MODEL = "gemini-3.8-flash-tts";
export const DEFAULT_TTS_VOICE = "Kore";

export type IntakeAiConfig = {
  /** Null when the key is not configured: the assistant reports itself unavailable. */
  apiKey: string | null;
  transcribeModel: string;
  extractModel: string;
  ttsModel: string;
  ttsVoice: string;
  /** A voice clip is short; this also keeps the request under the serverless body limit. */
  maxAudioBytes: number;
  maxUtteranceChars: number;
  timeoutMs: number;
  /** Per signed-in user. Voice turns are the expensive ones. */
  rate: {
    turn: { points: number; durationSeconds: number };
    transcribe: { points: number; durationSeconds: number };
    speak: { points: number; durationSeconds: number };
    photos: { points: number; durationSeconds: number };
  };
};

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function intakeAiConfig(env: Record<string, string | undefined> = process.env): IntakeAiConfig {
  // GEMINI_API_KEY is the documented name; AI_Property_Intake is accepted too because that is
  // how the key was first created in Vercel. Rename it to GEMINI_API_KEY when convenient.
  const key = (env.GEMINI_API_KEY ?? env.AI_Property_Intake)?.trim();
  const text = env.GEMINI_INTAKE_TEXT_MODEL?.trim() || env.GEMINI_MODEL?.trim() || DEFAULT_TEXT_MODEL;
  return {
    apiKey: key ? key : null,
    transcribeModel: env.GEMINI_INTAKE_TRANSCRIBE_MODEL?.trim() || text,
    extractModel: text,
    ttsModel: env.GEMINI_INTAKE_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL,
    ttsVoice: env.GEMINI_INTAKE_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE,
    maxAudioBytes: int(env.INTAKE_MAX_AUDIO_BYTES, 3 * 1024 * 1024, 20_000, 3_300_000),
    maxUtteranceChars: int(env.INTAKE_MAX_UTTERANCE_CHARS, 1500, 50, 4000),
    timeoutMs: int(env.INTAKE_AI_TIMEOUT_MS, 25_000, 2_000, 55_000),
    rate: {
      turn: { points: int(env.INTAKE_RATE_TURNS, 60, 1, 1000), durationSeconds: 600 },
      transcribe: { points: int(env.INTAKE_RATE_TRANSCRIBE, 40, 1, 1000), durationSeconds: 600 },
      speak: { points: int(env.INTAKE_RATE_SPEAK, 60, 1, 1000), durationSeconds: 600 },
      photos: { points: int(env.INTAKE_RATE_PHOTOS, 15, 1, 1000), durationSeconds: 600 },
    },
  };
}
