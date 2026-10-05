/**
 * One visitor message → one assistant reply.
 *
 * The loop is bounded (rounds, calls per round, output size, per-call timeout),
 * history is read as plain text only so a client cannot forge a tool result,
 * and everything the visitor can learn comes from the model's final text plus
 * the cards and action records built from real tool results.
 */

import type { Content, Part } from "@google/genai";

import type { AiConfig } from "./config";
import { AiProviderError, type LlmPort } from "./llm";
import { systemPrompt } from "./prompt";
import { executeTool, TOOL_DECLARATIONS, type ActionRecord, type PropertyCard, type ToolContext } from "./tools";

export type HistoryTurn = { role: "user" | "assistant"; text: string };

export type ChatInput = {
  message: string;
  history: HistoryTurn[];
  ctx: ToolContext;
  companyName: string;
  requestId: string;
  now?: Date;
};

export type ChatReply = {
  message: string;
  properties: PropertyCard[];
  actions: ActionRecord[];
};

export type ChatDeps = {
  llm: LlmPort;
  config: Pick<AiConfig, "model" | "timeoutMs" | "maxToolRounds" | "maxToolCallsPerRound" | "maxHistoryTurns" | "maxHistoryChars">;
  /** Values that must never appear in a reply, e.g. the API key itself. */
  secrets?: string[];
};

const SECRET_SHAPES = [/AIza[0-9A-Za-z_-]{20,}/g, /\bAQ\.[0-9A-Za-z_-]{20,}/g, /\bsk-[0-9A-Za-z_-]{20,}/g, /eyJ[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/g];

/** Last line of defence: a reply is never allowed to carry a credential. */
export function scrubSecrets(textIn: string, secrets: string[] = []): string {
  let out = textIn;
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join("[redacted]");
  for (const re of SECRET_SHAPES) out = out.replace(re, "[redacted]");
  return out;
}

export function sanitiseHistory(raw: unknown, config: Pick<AiConfig, "maxHistoryTurns" | "maxHistoryChars">): HistoryTurn[] {
  if (!Array.isArray(raw) || config.maxHistoryTurns === 0) return [];
  const turns: HistoryTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const { role, text } = t as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string" || text.trim() === "") continue;
    turns.push({ role, text: text.slice(0, config.maxHistoryChars) });
  }
  return turns.slice(-config.maxHistoryTurns);
}

function toContents(history: HistoryTurn[], message: string): Content[] {
  const contents: Content[] = history.map((t) => ({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.text }] }));
  contents.push({ role: "user", parts: [{ text: message }] });
  // Gemini requires the conversation to start with a user turn.
  while (contents.length > 1 && contents[0]!.role !== "user") contents.shift();
  return contents;
}

export async function runChat(deps: ChatDeps, input: ChatInput): Promise<ChatReply> {
  const { llm, config } = deps;
  const system = systemPrompt({
    companyName: input.companyName,
    today: (input.now ?? new Date()).toISOString().slice(0, 10),
    currentProperty: input.ctx.currentProperty?.reference ?? null,
  });
  const contents = toContents(input.history, input.message);

  const cards = new Map<string, PropertyCard>();
  const actions: ActionRecord[] = [];
  const finish = (message: string): ChatReply => ({
    message: scrubSecrets(message, deps.secrets),
    properties: [...cards.values()].slice(-6),
    actions,
  });

  for (let round = 0; round < config.maxToolRounds; round++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const started = Date.now();
    let response;
    try {
      response = await llm.generate({ system, contents, tools: TOOL_DECLARATIONS, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    console.info(`[home88:ai] req=${input.requestId} model=${config.model} round=${round} latencyMs=${Date.now() - started} calls=${response.calls.length}`);

    if (response.calls.length === 0) return finish(response.text);

    contents.push(response.content);
    const results: Part[] = [];
    for (const call of response.calls.slice(0, config.maxToolCallsPerRound)) {
      const t0 = Date.now();
      const out = await executeTool(call.name, call.args, input.ctx);
      console.info(`[home88:ai] req=${input.requestId} session=${input.ctx.sessionId} tool=${call.name} ok=${out.ok} latencyMs=${Date.now() - t0}`);
      for (const c of out.cards ?? []) cards.set(c.reference, c);
      if (out.action) actions.push(out.action);
      results.push({ functionResponse: { name: call.name, response: out.result } });
    }
    contents.push({ role: "user", parts: results });
  }

  // Out of rounds: stop rather than loop. Tool results already collected still render.
  throw new AiProviderError("empty");
}
