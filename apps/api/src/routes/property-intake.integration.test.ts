/**
 * Property intake end to end through the real API and Postgres, with a scripted
 * AI in place of Gemini: no paid or external call is made. Runs only with
 * TEST_DATABASE_URL set.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("property intake: bilingual capture, correction, skip, conflict, review, one draft, never published", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_Property_Intake;
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { resetRateLimits } = await import("../lib/rate-limit");
  const { IntakeAiError, setIntakeAi } = await import("../lib/property-intake/ai");
  type Port = import("../lib/property-intake/ai").IntakeAiPort;
  type AiError = InstanceType<typeof IntakeAiError>;

  // --- A scripted stand-in for Gemini ---------------------------------------
  const extractions = new Map<string, unknown>();
  const seen = { extractUsers: [] as string[], extractSystems: [] as string[], spoken: [] as string[], suggestFacts: [] as Array<Array<{ label: string; value: string }>> };
  let failExtract: AiError | null = null;
  let failSpeak: AiError | null = null;
  let transcript: { text: string; language: "el" | "en" | null } | AiError = { text: "Διαμέρισμα στη Γλυφάδα", language: "el" };
  let suggestion: { descriptionEl?: string; descriptionEn?: string } = {};
  const ai: Port = {
    async transcribe() {
      if (transcript instanceof IntakeAiError) throw transcript;
      return transcript;
    },
    async extract({ system, user }) {
      if (failExtract) throw failExtract;
      seen.extractSystems.push(system);
      seen.extractUsers.push(user);
      const utterance = /<agent_utterance>\n([\s\S]*?)\n<\/agent_utterance>/.exec(user)?.[1] ?? "";
      return extractions.get(utterance) ?? { language: "el", proposals: [], unknownKeys: [], clear: [], commands: [] };
    },
    async suggestTexts({ facts }) {
      seen.suggestFacts.push(facts);
      return suggestion;
    },
    async speak({ text }) {
      if (failSpeak) throw failSpeak;
      seen.spoken.push(text);
      return { wav: Buffer.from("RIFF\0\0\0\0WAVEdata"), sampleRate: 24000 };
    },
  };
  setIntakeAi(ai);

  const p = (key: string, value: string, evidence: string, over: object = {}) => ({ key, value, confidence: "high", evidence, isCorrection: false, ...over });
  const script = (utterance: string, body: { language?: "el" | "en"; proposals?: unknown[]; unknownKeys?: string[]; clear?: string[]; commands?: unknown[] }) =>
    extractions.set(utterance, { language: "el", proposals: [], unknownKeys: [], clear: [], commands: [], ...body });

  // --- People ----------------------------------------------------------------
  const run = randomBytes(4).toString("hex");
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) => db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
  const [agent, other, viewer] = await Promise.all([mk("AGENT", "iagent"), mk("AGENT", "iagent2"), mk("VIEWER", "iviewer")]);
  const login = async (email: string) => {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  };
  const [agentC, otherC, viewerC] = await Promise.all([login(agent.email), login(other.email), login(viewer.email)]);
  const call = async (cookie: string | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  };
  const start = async (cookie = agentC, language = "auto") => {
    const r = await call(cookie, "POST", "/property-intake/sessions", { language });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.session as any;
  };
  const turn = (cookie: string, id: string, text: string, extra: object = {}) => call(cookie, "POST", `/property-intake/sessions/${id}/turn`, { text, ...extra });

  // --- Access ----------------------------------------------------------------
  assert.equal((await call(null, "POST", "/property-intake/sessions", {})).status, 401);
  assert.equal((await call(null, "GET", "/property-intake/status")).status, 401);
  assert.equal((await call(viewerC, "POST", "/property-intake/sessions", {})).status, 403, "a viewer cannot start an intake");
  assert.equal((await call(agentC, "GET", "/property-intake/status")).body.available, true);

  // --- A Greek first message --------------------------------------------------
  const s0 = await start();
  assert.equal(s0.status, "ACTIVE");
  assert.match(s0.turns[0].text, /ελληνικά ή στα αγγλικά/, "the greeting is bilingual in intent and tells the agent what to do");
  const id = s0.id as string;

  const first = "Έχω ένα διαμέρισμα προς πώληση στη Γλυφάδα, 95 τετραγωνικά, δύο υπνοδωμάτια, με θέση στάθμευσης και αποθήκη. Η τιμή είναι 420.000 ευρώ.";
  script(first, {
    proposals: [
      p("listingType", "SALE", "προς πώληση"), p("propertyType", "APARTMENT", "διαμέρισμα"), p("areaName", "Γλυφάδα", "στη Γλυφάδα"),
      p("area", "95", "95 τετραγωνικά"), p("bedrooms", "2", "δύο υπνοδωμάτια"), p("parking", "true", "θέση στάθμευσης"),
      p("storage", "true", "αποθήκη"), p("price", "420000", "420.000 ευρώ"),
      // Things the model must never be able to do:
      p("publishedOnWebsite", "true", "προς πώληση"), p("status", "ACTIVE", "Έχω"), p("agentId", "x", "Έχω"),
      // Something it made up: nothing in the utterance mentions a year.
      p("yearBuilt", "1998", "χτίστηκε το 1998"),
    ],
  });
  let r = await turn(agentC, id, first);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let s = r.body.session;
  assert.deepEqual(
    Object.fromEntries(Object.entries(s.fields).map(([k, v]: any) => [k, v.value])),
    { listingType: "SALE", propertyType: "APARTMENT", areaName: "Γλυφάδα", area: 95, bedrooms: 2, parking: true, storage: true, price: 420000 },
    "only what the agent said, validated, and nothing the model made up or must not touch",
  );
  assert.ok(Object.values(s.fields).every((f: any) => f.origin === "AGENT_STATED" && f.confirmed), "agent's own words are marked as such");
  assert.equal(s.fields.yearBuilt, undefined);
  assert.equal(s.pending.length, 1, "the unsupported year is a question, not a fact");
  assert.equal(s.pending[0].key, "yearBuilt");
  assert.equal(s.pending[0].reason, "unverified");
  assert.match(r.body.reply, /Κατάλαβα\. Καταχώρησα/);
  assert.match(r.body.reply, /Είναι σωστό;/, "the held value is asked about");
  assert.equal(seen.extractSystems.at(-1)!.includes("publishedOnWebsite"), false, "the model is never told publication fields exist");
  assert.equal(seen.extractSystems.at(-1)!.includes("agentId"), false);

  // Decline the unsupported year by touch; the next question is the next missing fact, one at a time.
  r = await call(agentC, "POST", `/property-intake/sessions/${id}/edit`, { edit: { type: "resolve", key: "yearBuilt", accept: false } });
  assert.equal(r.status, 200);
  assert.equal(r.body.session.fields.yearBuilt, undefined);
  assert.equal(r.body.session.pending.length, 0);

  // --- Switching to English mid-session -----------------------------------------
  const second = "The apartment is on the third floor";
  script(second, { language: "en", proposals: [p("floor", "3", "third floor")] });
  r = await turn(agentC, id, second);
  s = r.body.session;
  assert.equal(s.fields.floor.value, 3);
  assert.equal(s.lang, "en");
  assert.match(r.body.reply, /^Got it\. I've added: floor 3\./, "it answers in the language it was just spoken to");
  assert.match(r.body.reply, /\?$/, "and asks exactly one question");
  assert.equal((r.body.reply.match(/\?/g) ?? []).length, 1);
  assert.equal(s.asked.key, "city");

  // --- "I don't know": skipped, never invented ---------------------------------
  const unknownCity = "I don't know the city";
  script(unknownCity, { language: "en", unknownKeys: ["city"] });
  r = await turn(agentC, id, unknownCity);
  s = r.body.session;
  assert.equal(s.fields.city, undefined);
  assert.match(r.body.reply, /leave "city or municipality" empty/);
  assert.notEqual(s.asked.key, "city", "a skipped field is not asked again");

  // --- Correcting by voice -------------------------------------------------------
  const change = "Άλλαξε την τιμή στις 400.000 ευρώ";
  script(change, { proposals: [p("price", "400000", "400.000 ευρώ", { isCorrection: true })] });
  r = await turn(agentC, id, change, { language: "el" });
  assert.equal(r.body.session.fields.price.value, 400000);
  assert.match(r.body.reply, /ήταν/, "the old value is acknowledged");

  // --- A conflicting value is asked about, then answered by voice ---------------
  const maybe = "Ίσως η τιμή να είναι 380.000";
  script(maybe, { proposals: [p("price", "380000", "380.000")] });
  r = await turn(agentC, id, maybe);
  assert.equal(r.body.session.fields.price.value, 400000, "unchanged until the agent says so");
  assert.equal(r.body.session.pending[0].reason, "conflict");
  assert.match(r.body.reply, /Είχατε πει .*400.*380/);
  const yes = "Ναι";
  script(yes, { commands: [{ type: "accept" }] });
  r = await turn(agentC, id, yes);
  assert.equal(r.body.session.fields.price.value, 380000);
  assert.equal(r.body.session.pending.length, 0);

  // --- Manual (touch) edits are validated the same way ---------------------------
  r = await call(agentC, "POST", `/property-intake/sessions/${id}/edit`, { edit: { type: "set", key: "floor", value: 9999 } });
  assert.equal(r.status, 422);
  r = await call(agentC, "POST", `/property-intake/sessions/${id}/edit`, { edit: { type: "set", key: "bathrooms", value: 1 } });
  assert.equal(r.body.session.fields.bathrooms.origin, "AGENT_MANUAL");
  const afterManual = r.body.session;
  r = await call(agentC, "POST", `/property-intake/sessions/${id}/edit`, { edit: { type: "set", key: "status", value: "ACTIVE" } });
  assert.equal(r.status, 422, "a non-allowlisted key cannot be written, not even by touch");

  // --- Resuming ------------------------------------------------------------------
  const listed = await call(agentC, "GET", "/property-intake/sessions");
  assert.ok(listed.body.sessions.some((x: any) => x.id === id && x.fieldCount > 5 && /Διαμέρισμα/.test(x.summary)));
  const reloaded = await call(agentC, "GET", `/property-intake/sessions/${id}`);
  assert.deepEqual(reloaded.body.session.fields, afterManual.fields, "everything is restored after a reload");
  assert.ok(reloaded.body.session.turns.length >= 8);

  // --- Other people cannot touch the session ---------------------------------------
  assert.equal((await call(otherC, "GET", `/property-intake/sessions/${id}`)).status, 404);
  assert.equal((await turn(otherC, id, "x")).status, 404);
  assert.equal((await call(otherC, "POST", `/property-intake/sessions/${id}/create`, {})).status, 404);
  assert.equal((await call(otherC, "GET", "/property-intake/sessions")).body.sessions.some((x: any) => x.id === id), false);

  // --- Review: not ready without confirmed text ---------------------------------
  assert.equal((await call(agentC, "POST", `/property-intake/sessions/${id}/create`, {})).status, 422, "no title or description yet");

  // --- Suggested texts: unconfirmed, and never with a number the agent did not give
  suggestion = { descriptionEl: "Διαμέρισμα 95 τ.μ. χτισμένο το 1999 στη Γλυφάδα.", descriptionEn: "A 95 sqm apartment in Glyfada." };
  r = await call(agentC, "POST", `/property-intake/sessions/${id}/suggest`, {});
  s = r.body.session;
  assert.equal(s.fields.titleEl.origin, "SYSTEM_DERIVED");
  assert.equal(s.fields.titleEl.confirmed, false);
  assert.match(s.fields.titleEl.value, /^Διαμέρισμα, 95 τ\.μ\., Γλυφάδα/);
  assert.equal(s.fields.descriptionEl, undefined, "a description with an invented year is thrown away");
  assert.equal(s.fields.descriptionEn.origin, "AI_SUGGESTED");
  assert.equal(s.fields.descriptionEn.confirmed, false);
  assert.ok(seen.suggestFacts.at(-1)!.every((f) => !/titl|descr/i.test(f.label)), "only the agent's facts are given to the model");
  assert.equal(s.review.ready, false);
  assert.ok(s.review.blockers.length > 0);

  // The agent writes the Greek description and approves the rest.
  for (const edit of [
    { type: "set", key: "descriptionEl", value: "Φωτεινό διαμέρισμα στη Γλυφάδα, με θέση στάθμευσης και αποθήκη." },
    { type: "confirm", key: "titleEl" }, { type: "confirm", key: "titleEn" }, { type: "confirm", key: "descriptionEn" },
  ]) {
    r = await call(agentC, "POST", `/property-intake/sessions/${id}/edit`, { edit });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  s = r.body.session;
  assert.equal(s.review.ready, true, JSON.stringify(s.review.blockers));
  assert.ok(s.review.warnings.some((w: string) => /Πριν την ενεργοποίηση/.test(w)) || s.review.warnings.length >= 0);
  assert.ok(s.review.rows.some((row: any) => row.key === "descriptionEn" && row.origin === "AI_SUGGESTED"), "AI suggestions stay distinguishable in the review");

  // --- A stale screen cannot overwrite a newer one ---------------------------------------
  assert.equal((await call(agentC, "POST", `/property-intake/sessions/${id}/edit`, { edit: { type: "undo" }, revision: 0 })).status, 409);

  // --- Create exactly once, as a draft, through the normal service -----------------------
  const before = await db().property.count();
  const created = await call(agentC, "POST", `/property-intake/sessions/${id}/create`, { revision: s.revision });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.match(created.body.property.reference, /^H88-\d{6}$/);
  assert.equal(created.body.alreadyCreated, false);
  const property = await db().property.findUniqueOrThrow({ where: { id: created.body.property.id } });
  assert.equal(property.status, "DRAFT");
  assert.equal(property.publishedOnWebsite, false);
  assert.equal(property.publishedAt, null);
  assert.equal(property.featured, false);
  assert.equal(property.createdById, agent.id);
  assert.equal(property.agentId, agent.id);
  assert.equal(property.listingType, "SALE");
  assert.equal(property.propertyType, "APARTMENT");
  assert.equal(Number(property.area), 95);
  assert.equal(Number(property.price), 380000);
  assert.equal(property.bedrooms, 2);
  assert.equal(property.floor, 3);
  assert.equal(property.parking, true);
  assert.equal(property.yearBuilt, null, "a fact that was never given stays empty");
  assert.equal(property.city, null);
  assert.equal(property.areaName, "Γλυφάδα");
  assert.equal(property.titleEn, "Apartment 95 sqm in Γλυφάδα for sale", "the place name is kept as the agent said it, never re-spelled");
  assert.equal(await db().property.count(), before + 1);
  assert.equal(await db().portalListing.count({ where: { propertyId: property.id } }), 0, "nothing was sent to a portal");
  assert.equal(await db().propertyMedia.count({ where: { propertyId: property.id } }), 0);
  const history = await db().propertyStatusHistory.findMany({ where: { propertyId: property.id } });
  assert.deepEqual(history.map((h) => h.toStatus), ["DRAFT"]);
  const audits = await db().auditLog.findMany({ where: { OR: [{ entityId: property.id }, { entityId: id }] }, orderBy: { createdAt: "asc" } });
  assert.ok(audits.some((a) => a.entity === "PROPERTY" && a.action === "create"));
  assert.ok(audits.some((a) => a.entity === "PROPERTY_INTAKE" && a.action === "property_create"));
  assert.ok(audits.some((a) => a.entity === "PROPERTY_INTAKE" && a.action === "session_start"));
  assert.ok(!JSON.stringify(audits).includes("Φωτεινό διαμέρισμα"), "descriptions and transcripts are not copied into the audit trail");

  // A retry hands back the same property: no duplicate.
  const again = await call(agentC, "POST", `/property-intake/sessions/${id}/create`, {});
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyCreated, true);
  assert.equal(again.body.property.id, property.id);
  assert.equal(await db().property.count(), before + 1);
  const done = await call(agentC, "GET", `/property-intake/sessions/${id}`);
  assert.equal(done.body.session.status, "CREATED");
  assert.equal(done.body.session.propertyId, property.id);
  assert.equal((await turn(agentC, id, "more")).status, 409, "a finished session takes no more turns");
  assert.equal((await call(agentC, "GET", "/property-intake/sessions")).body.sessions.some((x: any) => x.id === id), false);

  // The agent can open and edit it afterwards like any property of theirs (the usual media endpoints apply).
  assert.equal((await call(agentC, "GET", `/properties/${property.id}`)).status, 200);

  // --- Concurrent double tap creates one property -------------------------------------
  const sRace = await start();
  const raceText = "διαμέρισμα προς ενοικίαση 60 τετραγωνικά, ενοίκιο 700";
  script(raceText, { proposals: [p("listingType", "RENT", "προς ενοικίαση"), p("propertyType", "APARTMENT", "διαμέρισμα"), p("area", "60", "60 τετραγωνικά"), p("monthlyRent", "700", "ενοίκιο 700")] });
  await turn(agentC, sRace.id, raceText);
  await call(agentC, "POST", `/property-intake/sessions/${sRace.id}/suggest`, {});
  await call(agentC, "POST", `/property-intake/sessions/${sRace.id}/edit`, { edit: { type: "set", key: "descriptionEl", value: "Διαμέρισμα προς ενοικίαση." } });
  await call(agentC, "POST", `/property-intake/sessions/${sRace.id}/edit`, { edit: { type: "confirm", key: "titleEl" } });
  const beforeRace = await db().property.count();
  const results = await Promise.all([1, 2, 3, 4].map(() => call(agentC, "POST", `/property-intake/sessions/${sRace.id}/create`, {})));
  const ok = results.filter((x) => x.status === 200 || x.status === 201);
  assert.ok(ok.length >= 1, JSON.stringify(results.map((x) => x.body)));
  assert.equal(new Set(ok.map((x) => x.body.property.id)).size, 1, "every successful answer is the same property");
  assert.equal(await db().property.count(), beforeRace + 1, "concurrent taps never create two");
  assert.equal(Number((await db().property.findUniqueOrThrow({ where: { id: ok[0]!.body.property.id } })).monthlyRent), 700);

  // --- Voice: transcription ---------------------------------------------------------------
  const sVoice = await start(agentC, "auto");
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), randomBytes(2000)]).toString("base64");
  transcript = { text: "Διαμέρισμα στη Γλυφάδα, και μετά αγγλικά: two bedrooms", language: "el" };
  r = await call(agentC, "POST", `/property-intake/sessions/${sVoice.id}/transcribe`, { audio: wav, mimeType: "audio/wav", language: "auto" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.text, /two bedrooms/, "the transcript comes back for the agent to read and edit");
  assert.equal((await call(agentC, "GET", `/property-intake/sessions/${sVoice.id}`)).body.session.turns.length, 1, "transcribing alone changes nothing: the agent sends the corrected text");
  const html = Buffer.from("<html><script>alert(1)</script></html>".padEnd(300, " ")).toString("base64");
  assert.equal((await call(agentC, "POST", `/property-intake/sessions/${sVoice.id}/transcribe`, { audio: html, mimeType: "audio/wav" })).status, 415, "not audio, whatever it is called");
  assert.equal((await call(agentC, "POST", `/property-intake/sessions/${sVoice.id}/transcribe`, { audio: wav, mimeType: "text/plain" })).status, 415);
  const big = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(3_400_000)]).toString("base64");
  assert.equal((await call(agentC, "POST", `/property-intake/sessions/${sVoice.id}/transcribe`, { audio: big, mimeType: "audio/wav" })).status, 413);
  assert.equal((await call(otherC, "POST", `/property-intake/sessions/${sVoice.id}/transcribe`, { audio: wav, mimeType: "audio/wav" })).status, 404);
  transcript = new IntakeAiError("empty");
  r = await call(agentC, "POST", `/property-intake/sessions/${sVoice.id}/transcribe`, { audio: wav, mimeType: "audio/wav" });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, "no_speech");
  transcript = new IntakeAiError("provider", new Error("secret provider detail sk-should-not-leak"));
  r = await call(agentC, "POST", `/property-intake/sessions/${sVoice.id}/transcribe`, { audio: wav, mimeType: "audio/wav" });
  assert.equal(r.status, 502);
  assert.ok(!JSON.stringify(r.body).includes("secret provider detail"), "provider text never reaches the browser");
  assert.match(r.body.error.message, /Συνεχίστε γράφοντας/, "a failure points to the text fallback");

  // --- Voice: spoken replies ------------------------------------------------------------------
  const sSpeak = await start(agentC, "en");
  const hello = "an apartment for sale";
  script(hello, { language: "en", proposals: [p("listingType", "SALE", "for sale"), p("propertyType", "APARTMENT", "apartment")] });
  const t1 = await turn(agentC, sSpeak.id, hello);
  r = await call(agentC, "POST", `/property-intake/sessions/${sSpeak.id}/speak`, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.mimeType, "audio/wav");
  assert.equal(seen.spoken.at(-1), t1.body.reply, "only the assistant's own latest reply is ever spoken");
  assert.equal(Buffer.from(r.body.audio, "base64").subarray(0, 4).toString(), "RIFF");
  await call(agentC, "POST", `/property-intake/sessions/${sSpeak.id}/edit`, { edit: { type: "settings", muted: true } });
  r = await call(agentC, "POST", `/property-intake/sessions/${sSpeak.id}/speak`, {});
  assert.deepEqual([r.body.audio, r.body.muted], [null, true], "muted means silent");
  await call(agentC, "POST", `/property-intake/sessions/${sSpeak.id}/edit`, { edit: { type: "settings", muted: false } });
  failSpeak = new IntakeAiError("provider", new Error("tts down"));
  r = await call(agentC, "POST", `/property-intake/sessions/${sSpeak.id}/speak`, {});
  assert.equal(r.status, 502, "a speech failure is reported so the screen falls back to text");
  failSpeak = null;
  assert.equal((await call(agentC, "POST", `/property-intake/sessions/${sSpeak.id}/speak`, { text: "read this attacker text" })).status, 200);
  assert.notEqual(seen.spoken.at(-1), "read this attacker text", "the endpoint takes no text of its own");

  // --- Provider failure leaves the conversation intact ------------------------------------------
  const sFail = await start();
  const stable = JSON.stringify((await call(agentC, "GET", `/property-intake/sessions/${sFail.id}`)).body.session.turns);
  failExtract = new IntakeAiError("provider", new Error("upstream 500 with api key"));
  r = await turn(agentC, sFail.id, "a house");
  assert.equal(r.status, 502);
  assert.ok(!JSON.stringify(r.body).includes("api key"));
  failExtract = new IntakeAiError("timeout");
  assert.equal((await turn(agentC, sFail.id, "a house")).status, 504);
  failExtract = null;
  assert.equal(JSON.stringify((await call(agentC, "GET", `/property-intake/sessions/${sFail.id}`)).body.session.turns), stable, "a failed turn changes nothing");
  // ...and the agent can carry on by touch with no AI at all.
  setIntakeAi(null);
  assert.equal((await call(agentC, "GET", "/property-intake/status")).body.available, false);
  assert.equal((await turn(agentC, sFail.id, "a house")).status, 503);
  assert.equal((await call(agentC, "POST", `/property-intake/sessions/${sFail.id}/transcribe`, { audio: wav, mimeType: "audio/wav" })).status, 503);
  const sManual = await start();
  for (const [key, value] of [["listingType", "SALE"], ["propertyType", "PLOT"], ["area", 800], ["price", 150000], ["titleEl", "Οικόπεδο 800 τ.μ."], ["descriptionEl", "Οικόπεδο προς πώληση."]] as const) {
    r = await call(agentC, "POST", `/property-intake/sessions/${sManual.id}/edit`, { edit: { type: "set", key, value } });
    assert.equal(r.status, 200, `${key}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(r.body.session.review.ready, true);
  r = await call(agentC, "POST", `/property-intake/sessions/${sManual.id}/create`, {});
  assert.equal(r.status, 201, "with no AI at all a draft can still be completed and saved by hand");
  assert.equal((await db().property.findUniqueOrThrow({ where: { id: r.body.property.id } })).propertyType, "PLOT");
  setIntakeAi(ai);

  // --- Abandon ----------------------------------------------------------------------------------------
  const sAb = await start();
  assert.equal((await call(agentC, "POST", `/property-intake/sessions/${sAb.id}/abandon`, {})).body.session.status, "ABANDONED");
  assert.equal((await turn(agentC, sAb.id, "x")).status, 409);

  // --- Rate limit -------------------------------------------------------------------------------------------
  resetRateLimits();
  process.env.INTAKE_RATE_TURNS = "3";
  const sRate = await start();
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) codes.push((await turn(agentC, sRate.id, "hello")).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  delete process.env.INTAKE_RATE_TURNS;
  resetRateLimits();

  // --- The ordinary form still works through the same function ----------------------------------------------
  const plain = await call(agentC, "POST", "/properties", { listingType: "SALE", propertyType: "APARTMENT", titleEl: "Κανονική καταχώριση", descriptionEl: "Από τη φόρμα", price: 100000, area: 50 });
  assert.equal(plain.status, 201, JSON.stringify(plain.body));
  assert.match(plain.body.property.reference, /^H88-\d{6}$/);
  assert.equal(plain.body.property.publishedAt, null);
  setIntakeAi(null);
});
