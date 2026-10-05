/**
 * Configuration for the public AI assistant. Server-only.
 *
 * GEMINI_API_KEY is read here and nowhere else, never logged, never returned,
 * and never given a NEXT_PUBLIC_ spelling: this module must not be imported
 * from a client component.
 */

/**
 * Google's moving alias for its current fast Flash model, so the default does
 * not go stale the way a pinned name from an old tutorial does. Pin a specific
 * model with GEMINI_MODEL when reproducibility matters more than freshness.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

export type AiConfig = {
  /** Null when the key is not configured; the endpoint then answers with a safe fallback. */
  apiKey: string | null;
  model: string;
  /** Characters accepted in one visitor message. */
  maxMessageChars: number;
  /** Prior turns the server will read from the client. */
  maxHistoryTurns: number;
  maxHistoryChars: number;
  maxOutputTokens: number;
  /** Per Gemini call; the whole request is bounded by rounds × this. */
  timeoutMs: number;
  /** Model↔tool round trips per visitor message. */
  maxToolRounds: number;
  maxToolCallsPerRound: number;
  rateLimit: { points: number; durationSeconds: number };
};

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function aiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const key = env.GEMINI_API_KEY?.trim();
  return {
    apiKey: key ? key : null,
    model: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    maxMessageChars: int(env.AI_MAX_MESSAGE_CHARS, 1000, 50, 4000),
    maxHistoryTurns: int(env.AI_MAX_HISTORY_TURNS, 12, 0, 40),
    maxHistoryChars: int(env.AI_MAX_HISTORY_CHARS, 1500, 100, 6000),
    maxOutputTokens: int(env.AI_MAX_OUTPUT_TOKENS, 700, 100, 4000),
    timeoutMs: int(env.AI_TIMEOUT_MS, 20_000, 2_000, 60_000),
    maxToolRounds: int(env.AI_MAX_TOOL_ROUNDS, 4, 1, 8),
    maxToolCallsPerRound: 3,
    rateLimit: {
      points: int(env.AI_RATE_LIMIT_POINTS, 20, 1, 1000),
      durationSeconds: int(env.AI_RATE_LIMIT_WINDOW_SECONDS, 600, 10, 86_400),
    },
  };
}
