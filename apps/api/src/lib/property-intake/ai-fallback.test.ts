/**
 * The text model's failures that a second model can fix are retried once on the speech model; the ones it
 * cannot (bad key, throttling, timeout) are not. No network: fetch is stubbed with the Gemini REST shapes.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createGeminiIntakeAi, IntakeAiError, samplingFor } from "./ai";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Reply = { status: number; body: unknown } | "hang";
type Call = { model: string; maxOutputTokens: number | undefined; temperature: number | undefined };
function stub(byModel: Record<string, Reply | Reply[]>) {
  const calls: Call[] = [];
  const seen: Record<string, number> = {};
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const model = /models\/([^:]+):generateContent/.exec(url)?.[1] ?? "?";
    const body = JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : "{}")));
    calls.push({ model, maxOutputTokens: body.generationConfig?.maxOutputTokens, temperature: body.generationConfig?.temperature });
    const plan = byModel[model] ?? { status: 500, body: { error: { code: 500, message: "x", status: "INTERNAL" } } };
    const reply = Array.isArray(plan) ? plan[Math.min(seen[model] ?? 0, plan.length - 1)]! : plan;
    seen[model] = (seen[model] ?? 0) + 1;
    if (reply === "hang") {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return new Promise<Response>((resolve, reject) => {
        // Never answers; a safety timer keeps the test from hanging if the SDK ignored the abort.
        const guard = setTimeout(() => resolve(new Response(JSON.stringify({ error: { code: 500, message: "late" } }), { status: 500 })), 3000);
        signal?.addEventListener("abort", () => { clearTimeout(guard); reject(new DOMException("aborted", "AbortError")); });
      });
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}
const ok = (text: string) => ({ status: 200, body: { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] } });
const err = (code: number, status: string, message = "refused", reason?: string) => ({ status: code, body: { error: { code, message, status, details: reason ? [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }] : [] } } });
const cutOff = (partial: string) => ({ status: 200, body: { candidates: [{ content: { role: "model", parts: partial ? [{ text: partial }] : [] }, finishReason: "MAX_TOKENS" }] } });

const TEXT = "gemini-3.5-flash-lite";
const SPEECH = "gemini-3.5-flash";
const ai = () => createGeminiIntakeAi({ apiKey: "test-key", transcribeModel: SPEECH, transcribeMode: "prompt", fallbackModel: TEXT, extractModel: TEXT, ttsModel: "tts", ttsVoice: "Kore" });
const extract = (ms = 5000) => ai().extract({ system: "s", user: "u", schema: { type: "object" } }, AbortSignal.timeout(ms));
const isAi = (category: string, check: (e: IntakeAiError) => boolean = () => true) => (e: unknown) => e instanceof IntakeAiError && e.category === category && check(e);

describe("extraction: success and request shape", () => {
  it("returns the model's JSON from the text model, with room to think and no temperature on Gemini 3", async () => {
    const calls = stub({ [TEXT]: ok('{"language":"el","proposals":[]}') });
    assert.deepEqual(await extract(), { language: "el", proposals: [] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.model, TEXT);
    assert.ok((calls[0]!.maxOutputTokens ?? 0) >= 8192);
    assert.equal(calls[0]!.temperature, undefined, "Gemini 3 keeps its default temperature (Google: lower values can loop)");
  });

  it("older models keep temperature 0", () => {
    assert.deepEqual(samplingFor("gemini-2.5-flash"), { temperature: 0 });
    assert.deepEqual(samplingFor("gemini-3.5-flash-lite"), {});
    assert.deepEqual(samplingFor("gemini-3-flash-preview"), {});
  });
});

describe("extraction: what a second model can fix", () => {
  it("a rejected text model (404 unknown model, 400 unsupported option) falls back to the speech model", async () => {
    for (const reply of [err(404, "NOT_FOUND", "models/x is not found"), err(400, "INVALID_ARGUMENT", "responseJsonSchema not supported")]) {
      const calls = stub({ [TEXT]: reply, [SPEECH]: ok('{"proposals":[]}') });
      assert.deepEqual(await extract(), { proposals: [] });
      assert.deepEqual(calls.map((c) => c.model), [TEXT, SPEECH]);
    }
  });

  it("truncated output (MAX_TOKENS) is never accepted, even if it happens to parse", async () => {
    for (const partial of ["", '{"proposals":[', '{"proposals":[]}']) {
      const calls = stub({ [TEXT]: cutOff(partial), [SPEECH]: ok('{"ok":true}') });
      assert.deepEqual(await extract(), { ok: true });
      assert.equal(calls.length, 2);
    }
  });

  it("malformed or empty structured output is tried once on the other model", async () => {
    for (const bad of [ok('{"proposals": [tru'), ok("   "), ok("Sure! Here is the JSON")]) {
      stub({ [TEXT]: bad, [SPEECH]: ok('{"ok":1}') });
      assert.deepEqual(await extract(), { ok: 1 });
    }
  });
});

describe("extraction: what another model cannot fix", () => {
  it("invalid credentials (401, 403, or Gemini's 400 API_KEY_INVALID) fail at once, without trying the other model", async () => {
    for (const reply of [err(401, "UNAUTHENTICATED"), err(403, "PERMISSION_DENIED"), err(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", "API_KEY_INVALID")]) {
      const calls = stub({ [TEXT]: reply, [SPEECH]: ok("{}") });
      await assert.rejects(extract(), isAi("provider"));
      assert.deepEqual(calls.map((c) => c.model), [TEXT], JSON.stringify(reply));
    }
  });

  it("rate limits get one retry on the same model and are not moved to the other model", async () => {
    let calls = stub({ [TEXT]: err(429, "RESOURCE_EXHAUSTED"), [SPEECH]: ok("{}") });
    await assert.rejects(extract(), isAi("provider", (e) => e.detail.status === 429));
    assert.deepEqual(calls.map((c) => c.model), [TEXT, TEXT]);
    calls = stub({ [TEXT]: [err(429, "RESOURCE_EXHAUSTED"), ok('{"ok":2}')] });
    assert.deepEqual(await extract(), { ok: 2 }, "a momentary limit passes on the retry");
  });

  it("a timeout stops: no second model", async () => {
    const calls = stub({ [TEXT]: "hang", [SPEECH]: ok("{}") });
    await assert.rejects(extract(200), isAi("timeout"));
    assert.deepEqual(calls.map((c) => c.model), [TEXT]);
  });

  it("both models failing reports the last failure, after at most four calls", async () => {
    const calls = stub({ [TEXT]: err(404, "NOT_FOUND"), [SPEECH]: cutOff("") });
    await assert.rejects(extract(), isAi("invalid", (e) => e.detail.finishReason === "MAX_TOKENS" && e.detail.model === SPEECH));
    assert.ok(calls.length <= 4);
    const worst = stub({ [TEXT]: err(503, "UNAVAILABLE"), [SPEECH]: err(503, "UNAVAILABLE") });
    await assert.rejects(extract(), isAi("provider"));
    assert.ok(worst.length <= 2, "a provider outage is retried once on the same model, not spread to the other");
  });
});

describe("what may be logged", () => {
  it("the error detail is status, model and finish reason only: no request, transcript or answer", async () => {
    stub({ [TEXT]: cutOff('{"address":"Οδός Ιδιωτική 5'), [SPEECH]: cutOff('{"owner":"Μαρία'), });
    let caught: IntakeAiError | null = null;
    await extract().catch((e: IntakeAiError) => { caught = e; });
    assert.ok(caught);
    const detail = JSON.stringify((caught as IntakeAiError).detail);
    assert.deepEqual(Object.keys((caught as IntakeAiError).detail).sort(), ["finishReason", "model"]);
    assert.ok(!/Ιδιωτική|Μαρία|test-key/.test(detail + (caught as IntakeAiError).message));
  });
});
