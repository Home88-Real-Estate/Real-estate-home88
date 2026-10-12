/**
 * What the agent sees when "Αποστολή στον βοηθό" fails, and what is (not) written. Real API and Postgres;
 * a scripted AI throws the failures the Gemini adapter reports. Runs only with TEST_DATABASE_URL set.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("property intake: Send failures are explained, nothing is written, manual entry still works", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { resetRateLimits } = await import("../lib/rate-limit");
  const { IntakeAiError, setIntakeAi } = await import("../lib/property-intake/ai");
  type Port = import("../lib/property-intake/ai").IntakeAiPort;

  let next: (() => unknown) | null = null;
  const ai: Port = {
    async transcribe() { return { text: "x", language: "el" }; },
    async extract() { if (next) return next(); return { language: "el", proposals: [{ key: "propertyType", value: "APARTMENT", confidence: "high", evidence: "Διαμέρισμα", isCorrection: false }], unknownKeys: [], clear: [], commands: [] }; },
    async suggestTexts() { return {}; },
    async labelPhotos() { return { labels: [] }; },
    async speak() { return { wav: Buffer.from("RIFF"), sampleRate: 24000 }; },
  };
  setIntakeAi(ai);
  const failure = (category: "provider" | "empty" | "invalid" | "timeout", detail: object = {}, cause?: unknown) => () => {
    const e = new IntakeAiError(category, cause);
    Object.assign(e.detail, detail);
    throw e;
  };

  const run = randomBytes(4).toString("hex");
  const password = "Integration-Test-Password-123";
  const user = await db().user.create({ data: { email: `senderr-${run}@test.invalid`, firstName: "S", lastName: "Test", role: "AGENT" as never, passwordHash: hashPassword(password, 10) } });
  const login = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password }) }));
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  };
  const session = (await call("POST", "/property-intake/sessions", { language: "el" })).body.session;
  const said = "Διαμέρισμα στην οδό Ιδιωτική 5, ιδιοκτήτρια Μαρία";

  const cases: Array<[string, () => unknown, number, string, RegExp]> = [
    ["truncated", failure("invalid", { model: "m", finishReason: "MAX_TOKENS" }), 502, "intake_ai_bad_answer", /δεν έδωσε έγκυρη απάντηση.*κρατήθηκε.*Βασικά στοιχεία/],
    ["empty", failure("empty", { model: "m" }), 502, "intake_ai_bad_answer", /Βασικά στοιχεία/],
    ["malformed shape", () => ({ proposals: "not a list", language: 7 }), 0, "", /./],
    ["invalid key 403", failure("provider", { status: 403, model: "m" }), 503, "intake_ai_key", /κλειδί.*διαχειριστή.*Βασικά στοιχεία/],
    ["invalid key 400", failure("provider", { status: 400, model: "m" }, Object.assign(new Error('{"error":{"message":"API key not valid"}}'), { status: 400 })), 503, "intake_ai_key", /κλειδί/],
    ["rate limit", failure("provider", { status: 429, model: "m" }), 503, "intake_ai_busy", /πολλά αιτήματα.*ένα λεπτό/],
    ["both models down", failure("provider", { status: 503, model: "m" }), 502, "intake_ai_error", /δεν απάντησε.*Βασικά στοιχεία/],
    ["timeout", failure("timeout"), 504, "intake_ai_timeout", /άργησε/],
  ];
  for (const [name, behaviour, status, code, message] of cases) {
    resetRateLimits();
    next = behaviour;
    const before = await db().propertyIntakeSession.findUniqueOrThrow({ where: { id: session.id } });
    const r = await call("POST", `/property-intake/sessions/${session.id}/turn`, { text: said, revision: before.revision });
    if (name === "malformed shape") {
      // The parser drops what it cannot use instead of failing: the turn goes through with nothing applied.
      assert.ok(r.status === 200 || r.body.error?.code === "intake_ai_bad_answer", `${name}: ${r.status} ${JSON.stringify(r.body)}`);
      if (r.status === 200) {
        // reset for the next cases
        next = null;
      }
      continue;
    }
    assert.equal(r.status, status, `${name}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error.code, code, name);
    assert.match(r.body.error.message, message, name);
    const after = await db().propertyIntakeSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(after.revision, before.revision, `${name}: nothing written to the draft`);
    assert.deepEqual(after.turns, before.turns, `${name}: the failed text is not stored`);
    assert.deepEqual(after.state, before.state, `${name}: no field changed`);
  }

  // Manual entry keeps working while the assistant fails.
  next = failure("provider", { status: 503 });
  let s = (await call("GET", `/property-intake/sessions/${session.id}`)).body.session;
  const edit = await call("POST", `/property-intake/sessions/${session.id}/edit`, { edit: { type: "set", key: "listingType", value: "SALE" }, revision: s.revision });
  assert.equal(edit.status, 200, "touch edits do not need the AI");

  // And a working assistant fills the draft.
  next = null;
  s = (await call("GET", `/property-intake/sessions/${session.id}`)).body.session;
  const okTurn = await call("POST", `/property-intake/sessions/${session.id}/turn`, { text: "Διαμέρισμα", revision: s.revision });
  assert.equal(okTurn.status, 200, JSON.stringify(okTurn.body));
  assert.equal(okTurn.body.session.fields.propertyType.value, "APARTMENT");
  setIntakeAi(null);
});
