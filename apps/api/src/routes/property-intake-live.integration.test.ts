/**
 * The live conversation's two endpoints through the real API and Postgres. Google's token endpoint is stubbed
 * (no network, no paid calls). Runs only with TEST_DATABASE_URL set.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("property intake live: tokens, validated facts, transcript, no property without the agent", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  const KEY = "AIza-integration-not-a-real-key";
  const previousKey = process.env.GEMINI_API_KEY;
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { resetRateLimits } = await import("../lib/rate-limit");

  // Google's side: the token endpoint answers with a token, or with the failure under test.
  const realFetch = globalThis.fetch;
  let google: () => Response = () => new Response(JSON.stringify({ name: `auth_tokens/${randomBytes(6).toString("hex")}` }), { status: 200, headers: { "content-type": "application/json" } });
  const googleBodies: any[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    if (!req.url.startsWith("https://generativelanguage.googleapis.com/")) return realFetch(input as string | URL | Request, init);
    googleBodies.push(JSON.parse(await req.text()));
    return google();
  }) as typeof fetch;

  try {
    const run = randomBytes(4).toString("hex");
    const password = "Integration-Test-Password-123";
    const mk = (tag: string) => db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: "AGENT" as never, passwordHash: hashPassword(password, 10) } });
    const [agent, other] = await Promise.all([mk("liveagent"), mk("liveother")]);
    const login = async (email: string) => {
      const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
      return res.headers.get("set-cookie")!.split(";")[0]!;
    };
    const [cookie, otherCookie] = await Promise.all([login(agent.email), login(other.email)]);
    const call = async (method: string, path: string, body?: unknown, as = cookie) => {
      const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers: { cookie: as, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) }));
      const text = await res.text();
      return { status: res.status, headers: res.headers, text, body: (text ? JSON.parse(text) : null) as any };
    };
    const session = (await call("POST", "/property-intake/sessions", { language: "auto" })).body.session;
    const base = `/property-intake/sessions/${session.id}/live`;

    // === Without a key: the feature says it is unavailable, and recording/typing still work =====
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_Property_Intake;
    let r = await call("GET", "/property-intake/status");
    assert.deepEqual(r.body.live, { available: false, model: null });
    r = await call("POST", `${base}/token`, {});
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, "intake_live_unavailable");
    assert.match(r.body.error.message, /ηχογράφηση ή πληκτρολόγηση/);

    process.env.GEMINI_API_KEY = KEY;
    r = await call("GET", "/property-intake/status");
    assert.deepEqual(r.body.live, { available: true, model: "gemini-3.8-live" });

    // === A token: only for the session's own agent, locked to this session's setup, never cached ===
    assert.equal((await call("POST", `${base}/token`, {}, otherCookie)).status, 404, "another agent's session");
    assert.equal((await call("POST", `/property-intake/sessions/nope/live/token`, {})).status, 404);
    r = await call("POST", `${base}/token`, {});
    assert.equal(r.status, 200, r.text);
    assert.match(r.body.token, /^auth_tokens\//);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.body.url, "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained");
    assert.equal(r.body.setup.model, "models/gemini-3.8-live");
    assert.deepEqual(r.body.audio, { inputSampleRate: 16000, outputSampleRate: 24000, inputMimeType: "audio/pcm;rate=16000" });
    assert.match(r.body.kickoff, /ξεκίνησε/);
    assert.ok(!r.text.includes(KEY), "the permanent key is never sent to the browser");
    assert.deepEqual(googleBodies.at(-1).bidiGenerateContentSetup, r.body.setup, "Google locks exactly what the browser will send");
    assert.equal(googleBodies.at(-1).uses, 1);
    const audit = await db().auditLog.findFirst({ where: { entity: "PROPERTY_INTAKE", entityId: session.id, action: "live_start" } });
    assert.ok(audit, "starting a live conversation is audited");
    assert.ok(!JSON.stringify(audit!.changes).includes("auth_tokens"), "the token is not stored");

    // Provider refusals become a calm message; the key is never echoed.
    google = () => new Response(JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }), { status: 400, headers: { "content-type": "application/json" } });
    r = await call("POST", `${base}/token`, {});
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, "intake_ai_key");
    google = () => new Response(JSON.stringify({ error: { code: 404, message: "models/gemini-3.8-live is not found" } }), { status: 404, headers: { "content-type": "application/json" } });
    r = await call("POST", `${base}/token`, {});
    assert.equal(r.status, 502);
    assert.equal(r.body.error.code, "intake_live_unavailable");
    google = () => new Response(JSON.stringify({ name: `auth_tokens/${randomBytes(6).toString("hex")}` }), { status: 200, headers: { "content-type": "application/json" } });
    assert.equal((await call("POST", `${base}/token`, { resumeHandle: "bad handle with spaces" })).status, 422);

    // === Facts: validated like a typed turn ========================================================
    const facts = (proposals: Array<[string, string, string, boolean?]>, extra: object = {}) => ({
      language: "el",
      proposals: proposals.map(([key, value, evidence, isCorrection]) => ({ key, value, confidence: "high", evidence, isCorrection: isCorrection ?? false })),
      ...extra,
    });
    const say = (text: string) => [{ role: "agent", text }];

    r = await call("POST", `${base}/sync`, { lines: [{ role: "assistant", text: "Γεια σας! Είναι για πώληση ή ενοικίαση;" }, ...say("Έχω ένα διαμέρισμα στη Γλυφάδα που θέλω να καταχωρίσω για πώληση.")], facts: facts([["listingType", "SALE", "για πώληση"], ["propertyType", "APARTMENT", "διαμέρισμα"], ["areaName", "Γλυφάδα", "στη Γλυφάδα"]]) });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.result.recorded.map((x: any) => x.field).sort(), ["areaName", "listingType", "propertyType"]);
    assert.equal(r.body.result.next.action, "ask");
    assert.equal(r.body.result.next.field, "price", "one next question: the price");
    assert.match(r.body.result.next.question, /τιμή/);
    assert.equal(r.body.session.fields.propertyType.value, "APARTMENT");
    assert.deepEqual(r.body.session.turns.slice(-2).map((t: any) => t.role), ["assistant", "agent"], "the spoken words are kept as the conversation's text");

    // Several facts at once; one the agent did not say is held, not written; a field outside the rules is refused.
    r = await call("POST", `${base}/sync`, { lines: say("Είναι 85 τετραγωνικά, δύο υπνοδωμάτια, και θέλω 320.000 ευρώ."), facts: facts([["area", "85", "85 τετραγωνικά"], ["bedrooms", "2", "δύο υπνοδωμάτια"], ["price", "320000", "320.000 ευρώ"], ["floor", "3", "τρίτος όροφος"], ["yearBuilt", "1700", "320.000"], ["ownerEmail", "a@b.gr", "320.000"]]) });
    assert.equal(r.status, 200, r.text);
    const res = r.body.result;
    assert.deepEqual(res.recorded.map((x: any) => x.field).sort(), ["area", "bedrooms", "price"]);
    assert.deepEqual(res.toConfirm.map((x: any) => x.field), ["floor"], "not said: asked as yes/no, not saved");
    assert.deepEqual(res.rejected.map((x: any) => x.field).sort(), ["ownerEmail", "yearBuilt"]);
    assert.equal(res.next.action, "confirm");
    assert.equal(r.body.session.fields.floor, undefined);
    assert.equal(r.body.session.fields.price.value, 320000);

    // A "no" to the held value; then a correction by voice.
    r = await call("POST", `${base}/sync`, { lines: say("Όχι."), facts: { proposals: [], commands: [{ type: "decline" }] } });
    assert.equal(r.body.session.pending.length, 0);
    r = await call("POST", `${base}/sync`, { lines: say("Συγγνώμη, η τιμή είναι τελικά 310 χιλιάδες."), facts: facts([["price", "310000", "τελικά 310 χιλιάδες", true]]) });
    assert.equal(r.body.session.fields.price.value, 310000);
    assert.equal(r.body.result.recorded[0].value, "€310.000");
    // An English sentence in the same conversation.
    r = await call("POST", `${base}/sync`, { lines: say("It also has a storage room."), facts: facts([["storage", "true", "has a storage room"]], { language: "en" }) });
    assert.equal(r.body.session.fields.storage.value, true);
    assert.equal(r.body.result.recorded[0].label, "storage room");

    // Commands the live model may not use are ignored; a fact the agent asks to remove is removed.
    r = await call("POST", `${base}/sync`, { lines: say("Βγάλε την αποθήκη."), facts: { proposals: [], clear: ["storage"], commands: [{ type: "language", key: "en" }, { type: "mute" }] } });
    assert.equal(r.body.session.fields.storage, undefined);
    assert.equal(r.body.session.language, "auto");
    assert.equal(r.body.session.muted, false);

    // Garbage from the model never breaks the draft.
    for (const bad of [{ proposals: "nope" }, { proposals: [{ key: 7 }] }, { commands: [{ type: "publish" }] }]) {
      r = await call("POST", `${base}/sync`, { lines: [], facts: bad });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.body.session.fields.price.value, 310000);
    }
    assert.equal((await call("POST", `${base}/sync`, { lines: [{ role: "system", text: "x" }] })).status, 422);
    assert.equal((await call("POST", `${base}/sync`, { lines: say("x") }, otherCookie)).status, 404, "another agent cannot write into this draft");

    // Transcript only (end of a spoken turn): saved without touching the facts.
    const before = r.body.session.revision;
    r = await call("POST", `${base}/sync`, { lines: [{ role: "assistant", text: "Υπάρχει θέση στάθμευσης;" }] });
    assert.equal(r.body.result, null);
    assert.equal(r.body.session.revision, before + 1);
    assert.equal(r.body.session.turns.at(-1).text, "Υπάρχει θέση στάθμευσης;");

    // === Reconnecting never makes a second draft; nothing becomes a property until the agent saves ===
    const sessionsBefore = await db().propertyIntakeSession.count({ where: { userId: agent.id } });
    r = await call("POST", `${base}/token`, { resumeHandle: "Cg0xMjM0NTY3ODkw-_resume" });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.setup.sessionResumption, { handle: "Cg0xMjM0NTY3ODkw-_resume" });
    assert.match(r.body.kickoff, /αποκαταστάθηκε/);
    assert.match(JSON.stringify(r.body.setup.systemInstruction), /price \(Τιμή[^)]*\) = €310\.000/, "the model is reminded of what is recorded");
    assert.equal(await db().propertyIntakeSession.count({ where: { userId: agent.id } }), sessionsBefore);
    assert.equal((await db().propertyIntakeSession.findUniqueOrThrow({ where: { id: session.id } })).propertyId, null);
    const review = await call("POST", `${base}/sync`, { lines: say("Αυτά είναι όλα."), facts: { proposals: [], commands: [{ type: "review" }] } });
    assert.equal(review.body.result.next.action, "review");
    assert.equal(review.body.session.propertyId, null, "'review' is a summary, not a save");
    // The agent reviews on screen: approves the suggested title (as on the review step), then saves.
    await call("POST", `/property-intake/sessions/${session.id}/edit`, { edit: { type: "set", key: "descriptionEl", value: "Διαμέρισμα 85 τ.μ. στη Γλυφάδα με δύο υπνοδωμάτια." } });
    const approved = await call("POST", `/property-intake/sessions/${session.id}/edit`, { edit: { type: "confirm", key: "titleEl" } });
    assert.equal(approved.status, 200, approved.text);
    assert.deepEqual(approved.body.session.review.blockers, []);
    const created = await call("POST", `/property-intake/sessions/${session.id}/create`, { revision: approved.body.session.revision });
    assert.equal(created.status, 201, created.text);
    const property = await db().property.findUniqueOrThrow({ where: { id: created.body.property.id } });
    assert.equal(property.status, "DRAFT");
    assert.equal(Number(property.price), 310000);
    assert.equal((await call("POST", `${base}/token`, {})).status, 409, "a finished session takes no more conversation");
    assert.equal((await call("POST", `${base}/sync`, { lines: say("x") })).status, 409);

    // === Rate limits ================================================================================
    resetRateLimits();
    process.env.INTAKE_RATE_LIVE = "2";
    const s2 = (await call("POST", "/property-intake/sessions", {})).body.session;
    assert.equal((await call("POST", `/property-intake/sessions/${s2.id}/live/token`, {})).status, 200);
    assert.equal((await call("POST", `/property-intake/sessions/${s2.id}/live/token`, {})).status, 200);
    assert.equal((await call("POST", `/property-intake/sessions/${s2.id}/live/token`, {})).status, 429);
    delete process.env.INTAKE_RATE_LIVE;
    resetRateLimits();
  } finally {
    globalThis.fetch = realFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
