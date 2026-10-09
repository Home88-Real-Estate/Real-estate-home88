import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { intakeApi, IntakeRequestError } from "./intake-client";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("intake API client", () => {
  it("posts JSON to the CRM's own API path with the session cookie", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ session: { id: "s1" } }), { status: 201 });
    }) as typeof fetch;
    await intakeApi.start("en");
    assert.equal(seen!.url, "/crm/api/property-intake/sessions");
    assert.equal(seen!.init.method, "POST");
    assert.equal(seen!.init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(seen!.init.body)), { language: "en" });
  });

  it("turns a lost connection into a calm, retryable message", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await assert.rejects(
      () => intakeApi.turn("s1", "hello", 0),
      (e: unknown) => e instanceof IntakeRequestError && e.retryable && e.code === "network" && /αποθηκευμένο/.test(e.message),
    );
  });

  it("surfaces the server's safe message and marks 5xx and 429 as retryable, 4xx as not", async () => {
    const reply = (status: number, code: string, message: string) => (async () => new Response(JSON.stringify({ error: { code, message } }), { status })) as typeof fetch;
    globalThis.fetch = reply(502, "intake_ai_error", "Συνεχίστε γράφοντας");
    await assert.rejects(() => intakeApi.speak("s1"), (e: unknown) => e instanceof IntakeRequestError && e.retryable && e.message === "Συνεχίστε γράφοντας");
    globalThis.fetch = reply(429, "rate_limited", "Πάρα πολλά αιτήματα");
    await assert.rejects(() => intakeApi.turn("s1", "x", 0), (e: unknown) => e instanceof IntakeRequestError && e.retryable);
    globalThis.fetch = reply(409, "intake_conflict", "Η συνεδρία άλλαξε");
    await assert.rejects(() => intakeApi.turn("s1", "x", 0), (e: unknown) => e instanceof IntakeRequestError && !e.retryable && e.status === 409);
  });

  it("survives a non-JSON error body", async () => {
    globalThis.fetch = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as typeof fetch;
    await assert.rejects(() => intakeApi.status(), (e: unknown) => e instanceof IntakeRequestError && e.message === "Σφάλμα 502");
  });
});
