import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";

import { AiProviderError, AiRefusedError, anthropicRequest, createAnthropicProvider } from "./ai";

const prompt = { system: "S", user: "U", maxTokens: 300 };

test("the request is text in, text out: no sampling parameters, no tools; effort only where the model takes it", () => {
  for (const model of ["claude-sonnet-5-5", "claude-opus-5-5"]) {
    const r = anthropicRequest(model, prompt) as unknown as Record<string, unknown>;
    assert.deepEqual(r.output_config, { effort: "low" }, model);
    for (const banned of ["temperature", "top_p", "top_k", "tools", "thinking", "stream"]) assert.ok(!(banned in r), `${model} must not send ${banned}`);
  }
  const haiku = anthropicRequest("claude-haiku-4-5", prompt) as unknown as Record<string, unknown>;
  assert.ok(!("output_config" in haiku), "Haiku does not take an effort");
  assert.deepEqual(haiku.messages, [{ role: "user", content: "U" }]);
  assert.equal(haiku.system, "S");
  assert.equal(haiku.max_tokens, 300);
});

const reply = (overrides: Record<string, unknown>) => ({ content: [{ type: "text", text: "  Γεια\r\n\r\n\r\nσου  " }], stop_reason: "end_turn", usage: { input_tokens: 11, output_tokens: 7 }, ...overrides }) as unknown as Anthropic.Message;

test("answers are cleaned text with token counts; truncation and refusal are explicit", async () => {
  const ok = createAnthropicProvider("k", "claude-sonnet-5-5", { messages: { create: async () => reply({}) } });
  assert.deepEqual(await ok.complete(prompt), { text: "Γεια\n\nσου", inputTokens: 11, outputTokens: 7, truncated: false });
  const cut = createAnthropicProvider("k", "claude-sonnet-5-5", { messages: { create: async () => reply({ stop_reason: "max_tokens" }) } });
  assert.equal((await cut.complete(prompt)).truncated, true);
  const no = createAnthropicProvider("k", "claude-sonnet-5-5", { messages: { create: async () => reply({ stop_reason: "refusal" }) } });
  await assert.rejects(() => no.complete(prompt), AiRefusedError);
});

test("provider failures become a category, never the vendor's message", async () => {
  const fail = (proto: object, message: string) =>
    createAnthropicProvider("sk-ant-secret", "claude-sonnet-5-5", {
      messages: {
        create: async () => {
          throw Object.assign(Object.create(proto), { message });
        },
      },
    });
  const cases: Array<[object, string]> = [
    [Anthropic.AuthenticationError.prototype, "auth"],
    [Anthropic.RateLimitError.prototype, "rate_limit"],
    [Anthropic.InternalServerError.prototype, "unavailable"],
    [Anthropic.BadRequestError.prototype, "bad_request"],
    [Error.prototype, "unknown"],
  ];
  for (const [proto, expected] of cases) {
    await assert.rejects(
      () => fail(proto, "vendor said: key sk-ant-secret and the prompt U").complete(prompt),
      (e: unknown) => e instanceof AiProviderError && e.failure === expected && !e.message.includes("sk-ant") && !e.message.includes("prompt"),
      expected,
    );
  }
});
