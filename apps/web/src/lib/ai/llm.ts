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

export function createGeminiLlm(config: Pick<AiConfig, "apiKey" | "model" | "maxOutputTokens">): LlmPort {
  if (!config.apiKey) throw new AiNotConfiguredError();
  const client = new GoogleGenAI({ apiKey: config.apiKey });

  return {
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
}
