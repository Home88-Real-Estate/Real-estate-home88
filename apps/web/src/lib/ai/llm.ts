/**
 * The one place that talks to Gemini.
 *
 * Everything above this file depends on `LlmPort`, so the chat loop and the
 * tools are tested with a scripted port and the real SDK is exercised only
 * against a configured server environment.
 */

import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";

import type { AiConfig } from "./config";

export type ToolCall = { name: string; args: Record<string, unknown> };

export type LlmRequest = {
  system: string;
  contents: Content[];
  tools: FunctionDeclaration[];
  signal: AbortSignal;
};

export type LlmResponse = {
  text: string;
  calls: ToolCall[];
  /** The model's turn exactly as returned, to be replayed with the tool results. */
  content: Content;
};

export interface LlmPort {
  generate(request: LlmRequest): Promise<LlmResponse>;
}

/** The key is missing: a deployment problem, not a visitor problem. */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not configured.");
    this.name = "AiNotConfiguredError";
  }
}

/** Any failure of the provider call. The message is never shown to visitors. */
export class AiProviderError extends Error {
  constructor(readonly category: "timeout" | "provider" | "empty", cause?: unknown) {
    super(`Gemini request failed (${category}).`);
    this.name = "AiProviderError";
    if (cause !== undefined) this.cause = cause;
  }
}

export const GEMINI_RETRY = { attempts: 2, baseDelayMs: 250 } as const;

function statusOf(cause: unknown): number | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const record = cause as { status?: unknown; code?: unknown };
  for (const value of [record.status, record.code]) {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

/** Transient provider failures worth one retry: throttling and 5xx. Permanent ones (bad key, bad model, bad request) are not. */
export function isTransientProviderFailure(cause: unknown): boolean {
  const status = statusOf(cause);
  if (status !== undefined) return status === 429 || (status >= 500 && status <= 504);
  return true;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wraps an LlmPort so a transient provider failure is retried once with a short
 * backoff, so a rate-limit or 5xx blip does not surface the "technical problem"
 * fallback to the visitor. Timeouts (aborted signals) and permanent errors are
 * never retried.
 */
export function withGeminiRetry(port: LlmPort, baseDelayMs: number = GEMINI_RETRY.baseDelayMs): LlmPort {
  return {
    async generate(request) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await port.generate(request);
        } catch (error) {
          const retriable =
            error instanceof AiProviderError &&
            error.category === "provider" &&
            !request.signal.aborted &&
            isTransientProviderFailure(error.cause);
          if (!retriable || attempt >= GEMINI_RETRY.attempts) throw error;
          await sleep(baseDelayMs * attempt);
        }
      }
    },
  };
}

export function createGeminiLlm(config: Pick<AiConfig, "apiKey" | "model" | "maxOutputTokens">): LlmPort {
  if (!config.apiKey) throw new AiNotConfiguredError();
  const client = new GoogleGenAI({ apiKey: config.apiKey });

  const base: LlmPort = {
    async generate({ system, contents, tools, signal }) {
      let response;
      try {
        response = await client.models.generateContent({
          model: config.model,
          contents,
          config: {
            systemInstruction: system,
            maxOutputTokens: config.maxOutputTokens,
            temperature: 0.4,
            tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
            abortSignal: signal,
          },
        });
      } catch (error) {
        throw new AiProviderError(signal.aborted ? "timeout" : "provider", error);
      }

      const content = response.candidates?.[0]?.content;
      const calls = (response.functionCalls ?? []).flatMap((c) =>
        c.name ? [{ name: c.name, args: (c.args ?? {}) as Record<string, unknown> }] : [],
      );
      const text = (content?.parts ?? [])
        .flatMap((p) => (typeof p.text === "string" && !p.thought ? [p.text] : []))
        .join("")
        .trim();

      if (!content || (calls.length === 0 && text.length === 0)) throw new AiProviderError("empty");
      return { text, calls, content };
    },
  };

  return withGeminiRetry(base);
}
