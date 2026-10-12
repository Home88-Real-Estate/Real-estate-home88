/** The text model's failures that a second model can fix are retried once on the speech model. No network: fetch is stubbed. */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createGeminiIntakeAi, IntakeAiError } from "./ai";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Reply = { status: number; body: unknown };
function stub(byModel: Record<string, Reply>) {
  const calls: Array<{ model: string; maxOutputTokens: number | undefined }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const model = /models\/([^:]+):generateContent/.exec(url)?.[1] ?? "?";
    const body = JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : "{}")));
    calls.push({ model, maxOutputTokens: body.generationConfig?.maxOutputTokens });
    const r = byModel[model] ?? { status: 500, body: { error: { code: 500, message: "x", status: "INTERNAL" } } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}
const ok = (text: string) => ({ status: 200, body: { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] } });
const refused = (code: number) => ({ status: code, body: { error: { code, message: "model not found", status: code === 404 ? "NOT_FOUND" : "INVALID_ARGUMENT" } } });
const cutOff = { status: 200, body: { candidates: [{ content: { role: "model", parts: [] }, finishReason: "MAX_TOKENS" }] } };

const ai = () => createGeminiIntakeAi({ apiKey: "test-key", transcribeModel: "speech-model", transcribeMode: "prompt", fallbackModel: "text-model", extractModel: "text-model", ttsModel: "tts", ttsVoice: "Kore" });
const extract = () => ai().extract({ system: "s", user: "u", schema: { type: "object" } }, AbortSignal.timeout(5000));

describe("text model fallback", () => {
  it("a refused text model (404/400) falls back to the speech model", async () => {
    for (const code of [404, 400]) {
      const calls = stub({ "text-model": refused(code), "speech-model": ok('{"language":"el","proposals":[]}') });
      assert.deepEqual(await extract(), { language: "el", proposals: [] });
      assert.deepEqual(calls.map((c) => c.model), ["text-model", "speech-model"]);
    }
  });

  it("a cut-off or unreadable answer is tried once on the other model", async () => {
    let calls = stub({ "text-model": cutOff, "speech-model": ok('{"ok":true}') });
    assert.deepEqual(await extract(), { ok: true });
    assert.equal(calls.length, 2);
    calls = stub({ "text-model": ok('{"proposals": [tru'), "speech-model": ok('{"ok":1}') });
    assert.deepEqual(await extract(), { ok: 1 });
  });

  it("leaves room for the model's thinking", async () => {
    const calls = stub({ "text-model": ok("{}") });
    await extract();
    assert.ok((calls[0]!.maxOutputTokens ?? 0) >= 8192);
  });

  it("a bad key is not hidden behind a second model, and the log detail carries status and model only", async () => {
    stub({ "text-model": refused(403), "speech-model": ok("{}") });
    await assert.rejects(extract(), (e: unknown) => e instanceof IntakeAiError && e.category === "provider" && e.detail.status === 403 && e.detail.model === "text-model");
  });

  it("when both fail, the last failure is reported", async () => {
    stub({ "text-model": refused(404), "speech-model": cutOff });
    await assert.rejects(extract(), (e: unknown) => e instanceof IntakeAiError && e.category === "empty" && e.detail.finishReason === "MAX_TOKENS" && e.detail.model === "speech-model");
  });
});
