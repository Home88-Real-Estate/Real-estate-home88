/**
 * Property intake, second release: linking an existing contact as owner, and
 * suggested labels for photos. Real API and Postgres; a scripted AI stands in
 * for Gemini, so no paid or external call is made. Runs only with
 * TEST_DATABASE_URL set.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A small real PNG (solid grey), big enough to pass the minimum payload size. */
function png(size = 24): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 128)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("property intake release 2: owner link and photo labels", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
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

  // --- A scripted stand-in for Gemini ---------------------------------------
  const seenImages: Array<Array<{ id: string; mimeType: string; bytes: number }>> = [];
  let labelResult: unknown = { labels: [] };
  let labelFailure: InstanceType<typeof IntakeAiError> | null = null;
  const ai: Port = {
    async transcribe() { return { text: "x", language: "el" }; },
    async extract() { return { language: "el", proposals: [], unknownKeys: [], clear: [], commands: [] }; },
    async suggestTexts() { return {}; },
    async labelPhotos({ images }) {
      seenImages.push(images.map((i) => ({ id: i.id, mimeType: i.mimeType, bytes: i.data.length })));
      if (labelFailure) throw labelFailure;
      return labelResult;
    },
    async speak() { return { wav: Buffer.from("RIFF\0\0\0\0WAVEdata"), sampleRate: 24000 }; },
  };
  setIntakeAi(ai);

  // --- People ----------------------------------------------------------------
  const run = randomBytes(4).toString("hex");
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) => db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
  const [agent, other, viewer] = await Promise.all([mk("AGENT", "p2agent"), mk("AGENT", "p2agent2"), mk("VIEWER", "p2viewer")]);
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
  const start = async (cookie = agentC) => (await call(cookie, "POST", "/property-intake/sessions", { language: "el" })).body.session as any;
  const edit = (cookie: string, id: string, e: object, revision?: number) => call(cookie, "POST", `/property-intake/sessions/${id}/edit`, { edit: e, revision });
  /** Makes a session that can be saved: the minimum the property rules need. */
  const readySession = async () => {
    const s = await start();
    for (const [key, value] of [["listingType", "SALE"], ["propertyType", "APARTMENT"], ["areaName", "Γλυφάδα"], ["city", "Αθήνα"], ["area", 80], ["price", 250000], ["titleEl", "Διαμέρισμα 80 τ.μ. Γλυφάδα"], ["descriptionEl", "Διαμέρισμα προς πώληση στη Γλυφάδα."]] as const) {
      const r = await edit(agentC, s.id, { type: "set", key, value });
      assert.equal(r.status, 200, `${key}: ${JSON.stringify(r.body)}`);
    }
    return (await call(agentC, "GET", `/property-intake/sessions/${s.id}`)).body.session as any;
  };

  const mkContact = (tag: string) => db().contact.create({ data: { reference: `C-T${tag}-${run}`, firstName: "Μαρία", lastName: `Παπαδοπούλου ${tag}`, roles: ["SELLER"] as never, status: "ACTIVE" as never } });

  // === Owner ================================================================
  const ownerA = await mkContact("A");
  const s1 = await readySession();
  assert.equal(s1.owner, null);
  assert.ok(s1.review.warnings.some((w: string) => /ιδιοκτήτης/.test(w)), "no owner is a gentle warning, not a blocker");
  assert.equal(s1.review.ready, true, `an owner is optional: ${JSON.stringify(s1.review.blockers)}`);

  assert.equal((await edit(viewerC, s1.id, { type: "owner", contactId: ownerA.id })).status, 403, "a viewer cannot");
  assert.equal((await edit(otherC, s1.id, { type: "owner", contactId: ownerA.id })).status, 404, "another agent's session is not visible");
  assert.equal((await edit(agentC, s1.id, { type: "owner", contactId: "no-such-contact" })).status, 404, "an unknown contact is refused");

  let r = await edit(agentC, s1.id, { type: "owner", contactId: ownerA.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.session.owner, { contactId: ownerA.id, reference: ownerA.reference, label: `Μαρία Παπαδοπούλου A` });
  assert.ok(!r.body.session.review.warnings.some((w: string) => /ιδιοκτήτης/.test(w)));
  const stored = await db().propertyIntakeSession.findUniqueOrThrow({ where: { id: s1.id } });
  assert.ok(!JSON.stringify(stored.state).includes("@") && !/phone|mobile|email/i.test(JSON.stringify((stored.state as any).owner)), "only the id and a display name are kept");

  r = await edit(agentC, s1.id, { type: "owner", contactId: null });
  assert.equal(r.body.session.owner, null, "it can be removed");
  r = await edit(agentC, s1.id, { type: "owner", contactId: ownerA.id });

  // Save: the owner is linked in the same transaction as the property.
  const created = await call(agentC, "POST", `/property-intake/sessions/${s1.id}/create`, {});
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.owner, "linked");
  const propertyId = created.body.property.id as string;
  const link = await db().propertyOwner.findMany({ where: { propertyId } });
  assert.equal(link.length, 1);
  assert.equal(link[0]!.contactId, ownerA.id);
  assert.equal(link[0]!.capacity, "OWNER");
  assert.equal(link[0]!.isPrimaryContact, true);
  const audit = await db().auditLog.findMany({ where: { entity: "CONTACT", entityId: ownerA.id, action: "link_property" } });
  assert.equal(audit.length, 1);
  assert.equal((audit[0]!.changes as any).via, "property_intake");
  const draft = await db().property.findUniqueOrThrow({ where: { id: propertyId } });
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.publishedOnWebsite, false, "choosing an owner publishes nothing");

  const again = await call(agentC, "POST", `/property-intake/sessions/${s1.id}/create`, {});
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyCreated, true);
  assert.equal(again.body.owner, "linked");
  assert.equal(await db().propertyOwner.count({ where: { propertyId } }), 1, "a retry never links twice");
  assert.equal((await edit(agentC, s1.id, { type: "owner", contactId: null })).status, 409, "a finished session cannot be edited");

  // The contact is deleted between choosing and saving: the property is still created, and the agent is told.
  const ownerB = await mkContact("B");
  const s2 = await readySession();
  await edit(agentC, s2.id, { type: "owner", contactId: ownerB.id });
  await db().contact.delete({ where: { id: ownerB.id } });
  const created2 = await call(agentC, "POST", `/property-intake/sessions/${s2.id}/create`, {});
  assert.equal(created2.status, 201, JSON.stringify(created2.body));
  assert.equal(created2.body.owner, "skipped");
  assert.equal(await db().propertyOwner.count({ where: { propertyId: created2.body.property.id } }), 0);

  // No owner chosen.
  const s3 = await readySession();
  const created3 = await call(agentC, "POST", `/property-intake/sessions/${s3.id}/create`, {});
  assert.equal(created3.body.owner, "none");

  // === Photo labels ==========================================================
  resetRateLimits();
  const s4 = await start();
  const img = (id: string, bytes = png(), mimeType = "image/png") => ({ id, mimeType, data: bytes.toString("base64") });
  const path = `/property-intake/sessions/${s4.id}/label-photos`;

  assert.equal((await call(null, "POST", path, { images: [img("a")] })).status, 401);
  assert.equal((await call(viewerC, "POST", path, { images: [img("a")] })).status, 403);
  assert.equal((await call(otherC, "POST", path, { images: [img("a")] })).status, 404, "another agent's session");

  labelResult = { labels: [{ id: "k", label: "KITCHEN", confidence: "high" }, { id: "b", label: "NOT_A_LABEL", confidence: "high" }, { id: "evil", label: "BEDROOM", confidence: "high" }] };
  r = await call(agentC, "POST", path, { images: [img("k"), img("b"), img("c")] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.labels.map((l: any) => [l.id, l.label, l.confidence]), [["k", "KITCHEN", "high"], ["b", "OTHER", "low"], ["c", "OTHER", "low"]], "one answer per photo sent, nothing the model invents");
  assert.equal(r.body.labels[0].labelEl, "Κουζίνα");
  assert.equal(r.body.labels[0].labelEn, "Kitchen");
  assert.deepEqual(seenImages.at(-1)!.map((i) => i.id), ["k", "b", "c"], "the model sees only the previews that were sent");
  assert.equal(await db().propertyMedia.count({ where: { originalName: { in: ["k", "b", "c"] } } }), 0, "nothing is stored");
  assert.equal(JSON.stringify((await db().propertyIntakeSession.findUniqueOrThrow({ where: { id: s4.id } })).state).includes("KITCHEN"), false, "suggestions are not kept on the session");

  // Refusals: not an image, bytes that disagree with the declared type, too many, duplicates, empty.
  assert.equal((await call(agentC, "POST", path, { images: [img("x", Buffer.from("<html>this is not an image at all but it is long enough to pass the size check, really, honestly yes</html>"))] })).status, 415);
  assert.equal((await call(agentC, "POST", path, { images: [img("x", png(), "image/jpeg")] })).status, 415, "a PNG declared as JPEG");
  assert.equal((await call(agentC, "POST", path, { images: Array.from({ length: 13 }, (_, i) => img(`p${i}`)) })).status, 422);
  assert.equal((await call(agentC, "POST", path, { images: [img("d"), img("d")] })).status, 422);
  assert.equal((await call(agentC, "POST", path, { images: [] })).status, 422);
  assert.equal((await call(agentC, "POST", path, { images: [{ id: "g", mimeType: "image/gif", data: "x".repeat(200) }] })).status, 422);

  // Provider trouble becomes a calm message; nothing from the provider is shown.
  labelFailure = new IntakeAiError("provider", new Error("secret provider detail sk-123"));
  r = await call(agentC, "POST", path, { images: [img("k")] });
  assert.equal(r.status, 502);
  assert.ok(!JSON.stringify(r.body).includes("sk-123"));
  labelFailure = null;

  setIntakeAi(null);
  assert.equal((await call(agentC, "POST", path, { images: [img("k")] })).status, 503, "no key: the assistant is unavailable, nothing else breaks");
  setIntakeAi(ai);
  assert.equal((await call(agentC, "GET", `/property-intake/sessions/${s4.id}`)).status, 200);

  // Rate limit.
  resetRateLimits();
  let limited = 0;
  for (let i = 0; i < 20; i++) if ((await call(agentC, "POST", path, { images: [img("k")] })).status === 429) limited += 1;
  assert.ok(limited > 0, "photo labelling is rate limited per user");

  setIntakeAi(null);
});
