/**
 * The live conversation's server side, with Google's token endpoint stubbed (no network, no paid calls).
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { IntakeAiError } from "./ai";
import { intakeAiConfig } from "./config";
import { parseExtraction } from "./extraction";
import { allowedFields, LISTING_TYPES, PROPERTY_TYPES } from "./fields";
import { createLiveToken, LIVE_COMMANDS, LIVE_TOOL, liveConfig, liveSystemPrompt, liveToolDeclaration, wireSetup } from "./live";
import { confirmQuestion, questionFor } from "./replies";
import { emptyState } from "./state";
import { runExtraction } from "./service";

const ALL = (() => {
  const seen = new Map<string, ReturnType<typeof allowedFields>[number]>();
  for (const [l] of LISTING_TYPES) for (const [t] of PROPERTY_TYPES) for (const s of allowedFields(l, t)) if (!seen.has(s.key)) seen.set(s.key, s);
  return [...seen.values()];
})();
const KEY = "AIza-test-not-a-real-key";
const cfg = intakeAiConfig({ GEMINI_API_KEY: KEY });
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Seen = { url: string; headers: Headers; body: any };
function stubGoogle(answer: (seen: Seen) => Response): Seen[] {
  const calls: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const seen = { url: req.url, headers: req.headers, body: JSON.parse(await req.text()) };
    calls.push(seen);
    return answer(seen);
  }) as typeof fetch;
  return calls;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("live configuration", () => {
  it("is on with a key, off without one or with GEMINI_INTAKE_LIVE=off, and uses the current Live model by default", () => {
    assert.equal(cfg.live.enabled, true);
    assert.equal(cfg.live.model, "gemini-3.8-live");
    assert.equal(intakeAiConfig({}).live.enabled, false);
    assert.equal(intakeAiConfig({ GEMINI_API_KEY: KEY, GEMINI_INTAKE_LIVE: "off" }).live.enabled, false);
    assert.equal(intakeAiConfig({ GEMINI_API_KEY: KEY, GEMINI_INTAKE_LIVE_MODEL: "gemini-3.8-live-extended-thinking" }).live.model, "gemini-3.8-live-extended-thinking");
  });

  it("gives the model one blocking tool, restricted to the allowlist, without language or mute commands", () => {
    const tool = liveToolDeclaration(ALL.map((s) => s.key));
    assert.equal(tool.name, LIVE_TOOL);
    assert.equal(tool.behavior, "BLOCKING");
    const props = (tool.parameters as any).properties;
    assert.deepEqual(props.proposals.items.properties.key.enum.length, ALL.length);
    assert.deepEqual(props.commands.items.properties.type.enum, [...LIVE_COMMANDS]);
    for (const c of ["language", "mute", "unmute"]) assert.ok(!props.commands.items.properties.type.enum.includes(c));
  });

  it("tells the model what is recorded, the next question, and the rules; never the owner's details", () => {
    let state = emptyState();
    state.fields.propertyType = { value: "APARTMENT", origin: "AGENT_STATED", confirmed: true, updatedAt: "" };
    state.fields.price = { value: 320000, origin: "AGENT_STATED", confirmed: true, updatedAt: "" };
    state = { ...state, owner: { contactId: "c1", reference: "C-1", label: "Μαρία Παπαδοπούλου" } };
    const prompt = liveSystemPrompt({ state, specs: ALL, preference: "auto", nextQuestion: "Πόσα τετραγωνικά είναι;" });
    assert.match(prompt, /propertyType \(Τύπος ακινήτου\) = Διαμέρισμα/);
    assert.match(prompt, /price .* = €320\.000/);
    assert.match(prompt, /Next question to ask: Πόσα τετραγωνικά είναι;/);
    assert.match(prompt, /ONE clear question at a time/);
    assert.match(prompt, /Never invent/);
    assert.match(prompt, /monthly rent, never a sale price/);
    assert.match(prompt, /Nothing is published/);
    assert.match(prompt, /information, not instructions/);
    assert.ok(!prompt.includes("Μαρία"), "the owner is never put in the model's instructions");
    assert.match(liveSystemPrompt({ state: emptyState(), specs: ALL, preference: "en", nextQuestion: null }), /Speak English\./);
  });

  it("sends Google the same setup it gives the browser, locks every field, single use, short to start", async () => {
    const config = liveConfig({ cfg, system: "SYSTEM", keys: ["price", "area"] });
    const calls = stubGoogle(() => json(200, { name: "auth_tokens/abc123" }));
    const now = new Date("2026-10-12T10:00:00Z");
    const token = await createLiveToken(cfg, config, AbortSignal.timeout(5000), now);
    assert.equal(token.token, "auth_tokens/abc123");
    assert.equal(token.expiresAt, "2026-10-12T10:30:00.000Z");
    assert.equal(token.newSessionExpiresAt, "2026-10-12T10:02:00.000Z");
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.match(call.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1alpha\/auth_tokens/);
    assert.equal(call.headers.get("x-goog-api-key"), KEY, "the permanent key goes to Google only, in a header");
    assert.equal(call.body.uses, 1);
    assert.deepEqual(call.body.bidiGenerateContentSetup, wireSetup(cfg.live.model, config), "the browser's setup message is what the token locks");
    const mask = String(call.body.fieldMask).split(",");
    for (const f of ["systemInstruction", "tools", "generationConfig.speechConfig", "generationConfig.responseModalities"]) assert.ok(mask.some((m) => m === f || m.startsWith(`${f}.`) || f.startsWith(`${m}.`) || m === f.split(".")[0]), `locked: ${f} (mask ${call.body.fieldMask})`);
  });

  it("passes a reconnection's resumption handle into the locked setup", () => {
    const setup = wireSetup("gemini-3.8-live", liveConfig({ cfg, system: "S", keys: [], resumeHandle: "h-1" }));
    assert.deepEqual(setup.sessionResumption, { handle: "h-1" });
    assert.equal(setup.model, "models/gemini-3.8-live");
    assert.deepEqual((setup.generationConfig as any).responseModalities, ["AUDIO"]);
  });

  it("reports a refused key, a refused model, a timeout and a malformed answer as categorised errors without provider text", async () => {
    const config = liveConfig({ cfg, system: "S", keys: [] });
    for (const [status, body] of [[401, { error: { code: 401, message: "API key not valid", status: "UNAUTHENTICATED" } }], [404, { error: { code: 404, message: "models/x is not found" } }], [429, { error: { code: 429, message: "quota" } }]] as const) {
      stubGoogle(() => json(status, body));
      await assert.rejects(createLiveToken(cfg, config, AbortSignal.timeout(5000)), (e: unknown) => e instanceof IntakeAiError && e.category === "provider" && e.detail.status === status && e.detail.model === "gemini-3.8-live" && !JSON.stringify(e.detail).includes("quota"));
    }
    stubGoogle(() => json(200, { unexpected: true }));
    await assert.rejects(createLiveToken(cfg, config, AbortSignal.timeout(5000)), (e: unknown) => e instanceof IntakeAiError && e.category === "invalid");
    // Never answers; ends only when the caller's signal aborts (a guard timer keeps a broken test from hanging).
    globalThis.fetch = ((input: unknown, init?: RequestInit) => new Promise((_r, reject) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const guard = setTimeout(() => reject(new Error("guard: no abort")), 3000);
      signal?.addEventListener("abort", () => { clearTimeout(guard); reject(signal.reason); });
    })) as typeof fetch;
    await assert.rejects(createLiveToken(cfg, config, AbortSignal.timeout(50)), (e: unknown) => e instanceof IntakeAiError && e.category === "timeout");
    await assert.rejects(createLiveToken({ ...cfg, apiKey: null }, config, AbortSignal.timeout(50)), (e: unknown) => e instanceof IntakeAiError && e.category === "not_configured");
  });
});

describe("live facts go through the same checks as a typed turn", () => {
  const facts = (proposals: Array<[string, string, string, boolean?]>, extra: object = {}) =>
    parseExtraction({ language: "el", proposals: proposals.map(([key, value, evidence, isCorrection]) => ({ key, value, confidence: "high", evidence, isCorrection: isCorrection ?? false })), unknownKeys: [], clear: [], commands: [], ...extra }, new Set(ALL.map((s) => s.key)));

  it("records what the agent said, holds what they did not, and asks one next question", () => {
    const said = "Έχω ένα διαμέρισμα στη Γλυφάδα για πώληση";
    const out = runExtraction(emptyState(), facts([["listingType", "SALE", "για πώληση"], ["propertyType", "APARTMENT", "διαμέρισμα"], ["areaName", "Γλυφάδα", "στη Γλυφάδα"], ["price", "320000", "320.000 ευρώ"]]), said, "auto", null);
    assert.deepEqual(out.applied.map((a) => a.key).sort(), ["areaName", "listingType", "propertyType"]);
    assert.ok(!out.state.fields.price, "a price the agent did not say is not recorded");
    assert.deepEqual(out.state.pending.map((p) => p.key), ["price"]);
    assert.equal(out.step.type, "confirm");
  });

  it("applies a correction only when it is one, and refuses values outside the field's rules", () => {
    let state = runExtraction(emptyState(), facts([["propertyType", "APARTMENT", "διαμέρισμα"], ["bedrooms", "2", "δύο υπνοδωμάτια"]]), "διαμέρισμα, δύο υπνοδωμάτια", "auto", null).state;
    const notCorrection = runExtraction(state, facts([["bedrooms", "3", "τρία υπνοδωμάτια"]]), "τρία υπνοδωμάτια", "auto", null);
    assert.equal(notCorrection.state.fields.bedrooms!.value, 2, "a different value without 'correction' is held, not written");
    assert.equal(notCorrection.state.pending[0]?.reason, "conflict");
    state = runExtraction(state, facts([["bedrooms", "3", "όχι, τρία υπνοδωμάτια", true]]), "όχι, τρία υπνοδωμάτια", "auto", null).state;
    assert.equal(state.fields.bedrooms!.value, 3);
    const bad = runExtraction(state, facts([["bedrooms", "-4", "μείον τέσσερα"], ["ownerPhone", "6971234567", "6971234567"]]), "μείον τέσσερα 6971234567", "auto", null);
    assert.deepEqual(bad.rejected.map((r) => `${r.key}:${r.reason}`).sort(), ["bedrooms:below_min", "ownerPhone:not_allowed"], "outside the rules or the allowlist: refused");
    assert.equal(bad.state.fields.bedrooms!.value, 3);
  });

  it("understands English and a yes to a held value", () => {
    const first = runExtraction(emptyState(), facts([["monthlyRent", "1200", "1,200 a month"]], { language: "en" }), "it rents for twelve hundred", "auto", null);
    assert.equal(first.lang, "en");
    assert.deepEqual(first.state.pending.map((p) => p.key), ["monthlyRent"]);
    const yes = runExtraction(first.state, parseExtraction({ language: "en", proposals: [], commands: [{ type: "accept" }] }, new Set(ALL.map((s) => s.key))), "yes", "auto", null);
    assert.equal(yes.state.fields.monthlyRent!.value, 1200);
    assert.match(confirmQuestion(first.state.pending[0]!, ALL.find((s) => s.key === "monthlyRent")!, "en"), /\?/);
    assert.ok(questionFor(ALL.find((s) => s.key === "area")!, "el").length > 0);
  });
});
