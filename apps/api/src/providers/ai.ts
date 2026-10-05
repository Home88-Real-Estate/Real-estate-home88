/**
 * AI providers. The only adapter is Anthropic's (Claude), through the official
 * SDK. Which provider and model are used is a setting; the API key is an
 * encrypted write-only secret read here and nowhere else, and it is never
 * logged or returned. An AI answer is only ever text for a person to review.
 */

import Anthropic from "@anthropic-ai/sdk";
import { cleanAiText, type AiPrompt } from "@home88/domain";

import { aiApiKey, aiConfig } from "../settings";
import { ProviderNotConfiguredError, type ProviderHealth } from "./types";

export type AiCompletion = { text: string; inputTokens: number | null; outputTokens: number | null; truncated: boolean };

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(prompt: AiPrompt): Promise<AiCompletion>;
  getStatus(): ProviderHealth;
}

/** The model declined to answer. Shown to the user as such; never retried with different wording. */
export class AiRefusedError extends Error {
  constructor() {
    super("The model declined this request.");
    this.name = "AiRefusedError";
  }
}

export type AiFailure = "auth" | "rate_limit" | "unavailable" | "bad_request" | "unknown";

/** A provider failure reduced to a category, so no vendor message (which could echo input) is stored or shown. */
export class AiProviderError extends Error {
  constructor(readonly failure: AiFailure) {
    super(`AI provider error: ${failure}`);
    this.name = "AiProviderError";
  }
}

export const FAILURE_MESSAGES: Record<AiFailure, string> = {
  auth: "Το API key του παρόχου AI δεν γίνεται δεκτό. Ελέγξτε το στις Ρυθμίσεις → AI βοηθός.",
  rate_limit: "Ο πάροχος AI περιόρισε προσωρινά τα αιτήματα. Δοκιμάστε ξανά σε λίγο.",
  unavailable: "Ο πάροχος AI δεν είναι διαθέσιμος αυτή τη στιγμή.",
  bad_request: "Ο πάροχος AI απέρριψε το αίτημα. Ελέγξτε το μοντέλο στις Ρυθμίσεις.",
  unknown: "Η υπηρεσία AI απέτυχε. Δοκιμάστε ξανά.",
};

/** Models that take an explicit effort (the Haiku generation rejects it). Short drafts do not need deep reasoning. */
const EFFORT_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

/** The request for one draft. No sampling parameters, no tools, no web access: text in, text out. */
export function anthropicRequest(model: string, prompt: AiPrompt): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: prompt.maxTokens,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
    ...(EFFORT_MODELS.has(model) ? { output_config: { effort: "low" as const } } : {}),
  };
}

type MessagesClient = { messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } };

function classify(error: unknown): AiFailure {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "auth";
  if (error instanceof Anthropic.RateLimitError) return "rate_limit";
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) return "bad_request";
  if (error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) return "unavailable";
  return "unknown";
}

export function createAnthropicProvider(apiKey: string, model: string, client?: MessagesClient): AiProvider {
  const sdk: MessagesClient = client ?? new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  return {
    name: "anthropic",
    model,
    async complete(prompt) {
      let response: Anthropic.Message;
      try {
        response = await sdk.messages.create(anthropicRequest(model, prompt));
      } catch (error) {
        throw new AiProviderError(classify(error));
      }
      if (response.stop_reason === "refusal") throw new AiRefusedError();
      const text = cleanAiText(response.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
      return {
        text,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        truncated: response.stop_reason === "max_tokens",
      };
    },
    getStatus: () => ({ state: "configured", provider: "anthropic", detail: model }),
  };
}

let override: AiProvider | null = null;

/** Test seam: a fake provider. `null` restores the configured one. */
export function setAiProvider(next: AiProvider | null): void {
  override = next;
}

/** The provider Settings describes, or a ProviderNotConfiguredError when AI is off or incomplete. */
export async function resolveAiProvider(): Promise<AiProvider> {
  if (override) return override;
  const cfg = await aiConfig();
  if (!cfg.enabled || cfg.provider !== "anthropic" || !cfg.model) throw new ProviderNotConfiguredError("AI");
  const key = await aiApiKey();
  if (!key) throw new ProviderNotConfiguredError("AI");
  return createAnthropicProvider(key, cfg.model);
}
