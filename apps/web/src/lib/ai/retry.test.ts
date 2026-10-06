import assert from "node:assert/strict";
import { test } from "node:test";

import { AiProviderError, GEMINI_RETRY, isTransientProviderFailure, withGeminiRetry, type LlmPort, type LlmRequest, type LlmResponse } from "./llm";

const OK: LlmResponse = { text: "ok", calls: [], content: { role: "model", parts: [{ text: "ok" }] } };

function request(aborted = false): LlmRequest {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return { system: "system", contents: [{ role: "user", parts: [{ text: "hi" }] }], tools: [], signal: controller.signal };
}

function failingPort(failures: Error[]): { port: LlmPort; count(): number } {
  let calls = 0;
  return {
    port: {
      async generate() {
        calls += 1;
        const next = failures.shift();
        if (next) throw next;
        return OK;
      },
    },
    count: () => calls,
  };
}

test("a transient provider failure (429) is retried once and the retry succeeds", async () => {
  const { port, count } = failingPort([new AiProviderError("provider", { status: 429 })]);
  const out = await withGeminiRetry(port, 0).generate(request());
  assert.equal(out.text, "ok");
  assert.equal(count(), 2);
});

test("a transient 5xx (503) is retried once", async () => {
  const { port, count } = failingPort([new AiProviderError("provider", { status: 503 })]);
  const out = await withGeminiRetry(port, 0).generate(request());
  assert.equal(out.text, "ok");
  assert.equal(count(), 2);
});

test("a permanent provider failure (401) is not retried", async () => {
  const { port, count } = failingPort([new AiProviderError("provider", { status: 401 })]);
  await assert.rejects(() => withGeminiRetry(port, 0).generate(request()), AiProviderError);
  assert.equal(count(), 1);
});

test("a timeout is never retried", async () => {
  const { port, count } = failingPort([new AiProviderError("timeout")]);
  await assert.rejects(() => withGeminiRetry(port, 0).generate(request()), AiProviderError);
  assert.equal(count(), 1);
});

test("an aborted request is not retried even when the failure looks transient", async () => {
  const { port, count } = failingPort([new AiProviderError("provider", { status: 429 })]);
  await assert.rejects(() => withGeminiRetry(port, 0).generate(request(true)), AiProviderError);
  assert.equal(count(), 1);
});

test("two consecutive transient failures surface the second attempt's error", async () => {
  const error = new AiProviderError("provider", { status: 429 });
  const { port, count } = failingPort([error, error]);
  await assert.rejects(() => withGeminiRetry(port, 0).generate(request()), AiProviderError);
  assert.equal(count(), GEMINI_RETRY.attempts);
});

test("an empty (no text, no calls) response is not retried", async () => {
  const { port, count } = failingPort([new AiProviderError("empty")]);
  await assert.rejects(() => withGeminiRetry(port, 0).generate(request()), AiProviderError);
  assert.equal(count(), 1);
});

test("isTransientProviderFailure classifies response statuses", () => {
  assert.equal(isTransientProviderFailure({ status: 429 }), true);
  assert.equal(isTransientProviderFailure({ status: 500 }), true);
  assert.equal(isTransientProviderFailure({ status: 503 }), true);
  assert.equal(isTransientProviderFailure({ status: 504 }), true);
  assert.equal(isTransientProviderFailure({ status: 400 }), false);
  assert.equal(isTransientProviderFailure({ status: 401 }), false);
  assert.equal(isTransientProviderFailure({ status: 403 }), false);
  assert.equal(isTransientProviderFailure({ status: "429" }), true);
  assert.equal(isTransientProviderFailure(new Error("ECONNRESET")), true);
  assert.equal(isTransientProviderFailure(undefined), true);
});