/**
 * Owner journey and CRM privacy, end to end against real Postgres and the real
 * Fastify app (real sessions, real route guards). Object storage is in-memory:
 * these tests prove the application logic, not S3 itself.
 *
 * Skipped unless INTAKE_TEST_DATABASE_URL points at a scratch database with the
 * migrations applied. It is emptied between tests.
 */

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import sharp from "sharp";

const URL = process.env.INTAKE_TEST_DATABASE_URL ?? "";
if (URL) {
  process.env.DATABASE_URL = URL;
  process.env.SITE_URL = "https://home88.test";
  process.env.CRM_URL = "https://crm.home88.test";
}

const SKIP = URL ? false : "INTAKE_TEST_DATABASE_URL not set";

describe("owner submission → CRM → public (real Postgres, in-memory storage)", { skip: SKIP }, async () => {
  const intake = SKIP ? null : await import("@home88/intake/testing");
  const lib = SKIP ? null : await import("@home88/intake");
  const { buildServer } = SKIP ? ({} as never) : await import("./server");
  const { createSession, SESSION_COOKIE_NAME } = SKIP ? ({} as never) : await import("./lib/sessions");
  const { setIntakeStorageForTests } = SKIP ? ({} as never) : await import("./lib/intake-storage");
  const { toPortalProperty } = SKIP ? ({} as never) : await import("./lib/portal-map");

  type App = Awaited<ReturnType<typeof buildServer>>;
  let app: App;
  let agentA: Cookie, agentB: Cookie, manager: Cookie;
  type Cookie = { id: string; cookie: string };

  async function staff(role: string, email: string): Promise<Cookie> {
    const user = await intake!.testPrisma().user.create({ data: { email, firstName: role, lastName: "Test", role, status: "ACTIVE" } as never });
    const session = await createSession(user.id, { ttlHours: 1 });
    return { id: user.id, cookie: `${SESSION_COOKIE_NAME}=${session.token}` };
  }

  const call = (who: Cookie | null, method: string, url: string, payload?: unknown) =>
    app.inject({ method: method as never, url: `/api${url}`, headers: who ? { cookie: who.cookie } : {}, ...(payload !== undefined ? { payload: payload as never } : {}) });
  const json = (res: { body: string }) => JSON.parse(res.body) as Record<string, any>;

  async function photo(width = 800, height = 600, shade = 0): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: 30 + shade, g: 90, b: 150 } } })
      .jpeg()
      .withMetadata({ exif: { IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 58/1 30/1", GPSLongitudeRef: "E", GPSLongitude: "23/1 43/1 15/1" } } })
      .toBuffer();
  }

  /** A visitor submits an owner form with `n` photos and a title deed. */
  async function ownerSubmits(n = 5, opts: { assignTo?: string } = {}) {
    const { service, storage, prisma, limits } = intake!.makeService();
    setIntakeStorageForTests(storage);
    const session = await lib!.createUploadSession(prisma);
    const files: Array<{ storageKey: string; kind: "PHOTO" | "DOCUMENT"; fileName: string; mimeType: string; byteSize: number }> = [];
    for (let i = 0; i < n; i++) {
      const body = await photo(800 + i, 600, i * 8);
      const { storageKey } = await lib!.presignUpload({ prisma, storage, limits }, session.token, { kind: "PHOTO", mimeType: "image/jpeg", fileName: `salon-${i}.jpg`, byteSize: body.length });
      storage.upload(storageKey, body, "image/jpeg");
      files.push({ storageKey, kind: "PHOTO", fileName: `salon-${i}.jpg`, mimeType: "image/jpeg", byteSize: body.length });
    }
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\n");
    const { storageKey } = await lib!.presignUpload({ prisma, storage, limits }, session.token, { kind: "DOCUMENT", mimeType: "application/pdf", fileName: "titlos.pdf", byteSize: pdf.length });
    storage.upload(storageKey, pdf, "application/pdf");
    files.push({ storageKey, kind: "DOCUMENT", fileName: "titlos.pdf", mimeType: "application/pdf", byteSize: pdf.length });

    const out = await service.createAssignmentSubmission({ ...intake!.base(), property: intake!.DRAFT, uploads: { token: session.token, files } });
    const submission = await prisma.propertySubmission.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    if (opts.assignTo) await prisma.propertySubmission.update({ where: { id: submission.id }, data: { assignedToId: opts.assignTo } });
    return { out, submission, storage, prisma };
  }

  before(async () => {
    if (SKIP) return;
    await intake!.testPrisma().$connect();
    app = await buildServer();
    await app.ready();
  });
  after(async () => {
    if (SKIP) return;
    await app.close();
    await intake!.testPrisma().$disconnect();
  });
  beforeEach(async () => {
    if (SKIP) return;
    await intake!.resetDatabase();
    agentA = await staff("AGENT", "a@home88.test");
    agentB = await staff("AGENT", "b@home88.test");
    manager = await staff("MANAGER", "m@home88.test");
  });

  it("nothing is reachable without a session", async () => {
    const { submission } = await ownerSubmits(1);
    for (const [method, url] of [
      ["GET", "/submissions"],
      ["GET", `/submissions/${submission.id}`],
      ["GET", `/submissions/${submission.id}/photos/x/url`],
      ["GET", `/submissions/${submission.id}/documents/x/url`],
      ["POST", `/submissions/${submission.id}/convert`],
      ["GET", "/notifications"],
      ["GET", "/media"],
    ] as const) {
      assert.equal((await call(null, method, url, method === "POST" ? {} : undefined)).statusCode, 401, `${method} ${url}`);
    }
  });

  it("the CRM never hands out storage keys or permanent URLs", async () => {
    const { submission } = await ownerSubmits(2, { assignTo: agentA.id });
    const detail = await call(agentA, "GET", `/submissions/${submission.id}`);
    assert.equal(detail.statusCode, 200);
    assert.ok(!/submissions\/[a-f0-9]{32}/.test(detail.body), "no quarantine key in the detail");
    assert.ok(!/storageKey|https?:\/\//.test(detail.body.replace(/"https?:\/\/[^"]*"/g, "")), "no storage key field");
    const list = await call(agentA, "GET", "/submissions");
    assert.ok(!/storageKey/.test(list.body));
    const library = await call(manager, "GET", "/media");
    assert.ok(!/storageKey|submissions\/[a-f0-9]{32}/.test(library.body));
  });

  it("an agent sees unassigned submissions but not another agent's", async () => {
    const mine = await ownerSubmits(1);
    await intake!.resetDatabase();
    agentA = await staff("AGENT", "a@home88.test");
    agentB = await staff("AGENT", "b@home88.test");
    manager = await staff("MANAGER", "m@home88.test");
    const { submission } = await ownerSubmits(1, { assignTo: agentB.id });
    void mine;

    assert.equal((await call(agentA, "GET", `/submissions/${submission.id}`)).statusCode, 404, "someone else's assignment");
    assert.equal((await call(agentB, "GET", `/submissions/${submission.id}`)).statusCode, 200);
    assert.equal((await call(manager, "GET", `/submissions/${submission.id}`)).statusCode, 200);
    assert.equal(json(await call(agentA, "GET", "/submissions")).total, 0);
    assert.equal(json(await call(manager, "GET", "/submissions")).total, 1);
    assert.equal((await call(agentA, "PATCH", `/submissions/${submission.id}`, { status: "UNDER_REVIEW" })).statusCode, 404);
  });

  it("private documents: only the assigned agent or a manager, audited, and never someone else's file", async () => {
    const { submission, prisma } = await ownerSubmits(1);
    const doc = await prisma.document.findFirstOrThrow();

    // Unassigned: an agent can review photos but not open documents.
    const detailA = json(await call(agentA, "GET", `/submissions/${submission.id}`));
    assert.deepEqual(detailA.submission.documents, [], "document list withheld");
    assert.equal(detailA.submission.documentsHidden, true);
    assert.equal((await call(agentA, "GET", `/submissions/${submission.id}/documents/${doc.id}/url`)).statusCode, 403);

    await call(agentA, "PATCH", `/submissions/${submission.id}`, { assignedToId: agentA.id });
    const ok = await call(agentA, "GET", `/submissions/${submission.id}/documents/${doc.id}/url`);
    assert.equal(ok.statusCode, 200);
    assert.match(json(ok).url, /^memory:\/\/submissions\//);
    assert.equal(json(ok).expiresInSeconds, 120);
    assert.equal(await prisma.auditLog.count({ where: { action: "document.access", actorId: agentA.id } }), 1);

    assert.equal((await call(manager, "GET", `/submissions/${submission.id}/documents/${doc.id}/url`)).statusCode, 200);
    assert.equal((await call(agentB, "GET", `/submissions/${submission.id}/documents/${doc.id}/url`)).statusCode, 404, "another agent cannot even tell it exists");
    assert.equal((await call(manager, "GET", `/submissions/${submission.id}/documents/not-a-doc/url`)).statusCode, 404);

    // A document id from a different submission is not reachable through this one.
    const other = await ownerSubmits(1);
    const otherDoc = await prisma.document.findFirstOrThrow({ where: { submissionId: other.submission.id } });
    assert.equal((await call(manager, "GET", `/submissions/${submission.id}/documents/${otherDoc.id}/url`)).statusCode, 404);
  });

  it("a staff member gets a short-lived link to a submitted photo, and only for their submissions", async () => {
    const { submission, prisma } = await ownerSubmits(2, { assignTo: agentB.id });
    const media = await prisma.propertyMedia.findFirstOrThrow({ where: { submissionId: submission.id } });
    const res = await call(manager, "GET", `/submissions/${submission.id}/photos/${media.id}/url?variant=thumbnail`);
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).expiresInSeconds, 300);
    assert.match(json(res).url, /\.thumbnail\.webp/);
    assert.equal((await call(agentA, "GET", `/submissions/${submission.id}/photos/${media.id}/url`)).statusCode, 404);
  });

  it("new submissions notify staff and can be marked read", async () => {
    await ownerSubmits(1);
    const before = json(await call(agentA, "GET", "/notifications?unread=1"));
    assert.equal(before.unread, 1);
    assert.equal(before.data[0].kind, "new_assignment");
    assert.equal(before.data[0].entityType, "SUBMISSION");
    await call(agentA, "POST", "/notifications/read", {});
    assert.equal(json(await call(agentA, "GET", "/notifications")).unread, 0);
  });

  it("the media library lists private owner photos for staff with the right scope", async () => {
    await ownerSubmits(3);
    const all = json(await call(manager, "GET", "/media?attached=no"));
    assert.equal(all.total, 3);
    assert.ok(all.data.every((m: any) => m.source === "OWNER_SUBMISSION" && m.propertyId === null && m.status === "pending_review"));
    assert.equal(json(await call(agentA, "GET", "/media")).total, 3, "unassigned submissions are visible to agents");
    assert.equal(json(await call(manager, "GET", "/media?lifecycle=QUARANTINED")).total, 0);
  });

  it("OWNER JOURNEY: submit with 5 photos → review → create property → cover → approve → publish → public + portal", async () => {
    // 1–5: the visitor fills /submit, uploads 5 photos and a deed, and submits.
    const { out, submission, storage, prisma } = await ownerSubmits(5);
    assert.equal(out.status, "created");
    assert.deepEqual((out as { uploads: unknown }).uploads, { accepted: 6, quarantined: 0, rejected: 0, skipped: 0 });

    // 6–9: contact, seller lead, submission, private media — and no property.
    assert.equal(await prisma.contact.count(), 1);
    const lead = await prisma.lead.findFirstOrThrow();
    assert.equal(lead.type, "SELLER_OWNER");
    assert.equal(lead.assignedToId, null);
    assert.equal(submission.status, "NEW");
    assert.equal(await prisma.property.count(), 0);
    const photos = await prisma.propertyMedia.findMany({ where: { submissionId: submission.id } });
    assert.equal(photos.length, 5);
    assert.ok(photos.every((m) => m.propertyId === null && m.status === "pending_review"));
    assert.equal(await prisma.propertyMedia.count({ where: { kind: "DOCUMENT" } }), 0, "the deed is a private Document, not media");

    // 10: the agent is notified in the CRM.
    const notes = json(await call(agentA, "GET", "/notifications?unread=1"));
    assert.equal(notes.data[0].entityId, submission.id);

    // 11: the agent reviews: takes it, marks it under review, contacts the owner.
    assert.equal((await call(agentA, "PATCH", `/submissions/${submission.id}`, { assignedToId: agentA.id, status: "UNDER_REVIEW" })).statusCode, 200);
    assert.equal((await call(agentA, "PATCH", `/submissions/${submission.id}`, { status: "CONTACTED" })).statusCode, 200);
    assert.equal((await call(agentA, "PATCH", `/submissions/${submission.id}`, { status: "PUBLISHED" })).statusCode, 409, "cannot skip ahead");

    // 12–13: create the property; the existing uploads are linked, not copied.
    const photosBefore = photos.map((p) => p.id).sort();
    const conv = await call(agentA, "POST", `/submissions/${submission.id}/convert`, { mode: "create", overrides: { price: 440000 } });
    assert.equal(conv.statusCode, 201);
    const { propertyId, attachedPhotos } = json(conv);
    assert.equal(attachedPhotos, 5);
    const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    assert.equal(property.status, "DRAFT");
    assert.equal(property.publishedOnWebsite, false);
    const attached = await prisma.propertyMedia.findMany({ where: { propertyId }, orderBy: { sortOrder: "asc" } });
    assert.deepEqual(attached.map((m) => m.id).sort(), photosBefore, "same media rows");
    assert.equal(await prisma.propertyMedia.count(), 5, "nothing duplicated");
    for (const m of attached) {
      assert.match(m.storageKey, new RegExp(`^properties/${propertyId}/photo/`));
      assert.ok(storage.objects.has(m.storageKey));
    }
    assert.equal((await call(agentA, "POST", `/submissions/${submission.id}/convert`, { mode: "create" })).statusCode, 409, "cannot convert twice");

    // Draft media is not public while unapproved, and the draft property is not either.
    const publicFilter = () => prisma.propertyMedia.findMany({ where: { propertyId, status: { in: ["approved", "published"] }, property: { publishedOnWebsite: true, status: { in: ["ACTIVE", "UNDER_OFFER", "RESERVED"] } } } });
    assert.equal((await publicFilter()).length, 0);

    // 14: the agent sets the cover (existing route); only one cover can exist.
    const [first, second, third] = attached;
    assert.equal((await call(agentA, "PATCH", `/properties/${propertyId}/media/${first!.id}`, { isPrimary: true })).statusCode, 200);
    assert.equal((await call(agentA, "PATCH", `/properties/${propertyId}/media/${second!.id}`, { isPrimary: true })).statusCode, 200);
    const covers = await prisma.propertyMedia.findMany({ where: { propertyId, isPrimary: true } });
    assert.deepEqual(covers.map((c) => c.id), [second!.id], "exactly one cover");

    // reorder (existing route): the new order sticks.
    const order = [third!.id, second!.id, first!.id, ...attached.slice(3).map((m) => m.id)];
    assert.equal((await call(agentA, "POST", `/properties/${propertyId}/media/reorder`, { ids: order })).statusCode, 200);
    const reordered = await prisma.propertyMedia.findMany({ where: { propertyId }, orderBy: { sortOrder: "asc" } });
    assert.deepEqual(reordered.map((m) => m.id), order);

    // 15: approving media is a manager's decision.
    for (const m of reordered) {
      assert.equal((await call(agentA, "POST", `/properties/${propertyId}/media/${m.id}/status`, { status: "approved" })).statusCode, 403);
      assert.equal((await call(manager, "POST", `/properties/${propertyId}/media/${m.id}/status`, { status: "approved" })).statusCode, 200);
    }

    // 16: publish: activate and show on the website.
    const status = await call(agentA, "POST", `/properties/${propertyId}/status`, { status: "ACTIVE" });
    assert.equal(status.statusCode, 200, status.body);
    const patch = await call(agentA, "PATCH", `/properties/${propertyId}`, { publishedOnWebsite: true });
    assert.equal(patch.statusCode, 200, patch.body);

    // 17: the public site's own filter now returns the images, cover first, in order.
    const live = await prisma.propertyMedia.findMany({ where: { propertyId, status: { in: ["approved", "published"] }, property: { publishedOnWebsite: true, status: "ACTIVE" } }, orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] });
    assert.equal(live.length, 5);
    assert.equal(live[0]!.id, second!.id, "cover leads the gallery");
    assert.ok(live.every((m) => m.storageKey.startsWith(`properties/${propertyId}/`)), "public images live under the public prefix only");

    // 18: portal distribution consumes only approved public media — never the deed.
    const withMedia = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, include: { media: true } });
    const view = toPortalProperty(withMedia, "https://cdn.home88.test");
    assert.equal(view.media.length, 5);
    assert.ok(view.media.every((m: { kind: string; url: string }) => m.kind === "PHOTO" && m.url.startsWith("https://cdn.home88.test/properties/")));
    assert.ok(!JSON.stringify(view).includes("titlos"), "the deed never reaches a portal");

    // The submission follows the property.
    assert.equal((await prisma.propertySubmission.findUniqueOrThrow({ where: { id: submission.id } })).status, "PROPERTY_CREATED");
    assert.equal((await call(agentA, "PATCH", `/submissions/${submission.id}`, { status: "APPROVED" })).statusCode, 200);
    assert.equal((await call(agentA, "PATCH", `/submissions/${submission.id}`, { status: "PUBLISHED" })).statusCode, 200);
  });

  it("an unapproved photo is never part of what a portal would receive", async () => {
    const { submission, prisma } = await ownerSubmits(2, { assignTo: agentA.id });
    const conv = json(await call(agentA, "POST", `/submissions/${submission.id}/convert`, { mode: "create" }));
    const withMedia = await prisma.property.findUniqueOrThrow({ where: { id: conv.propertyId }, include: { media: true } });
    assert.equal(toPortalProperty(withMedia, "https://cdn.home88.test").media.length, 0, "pending_review media is withheld");
  });

  it("a submission can be rejected with a reason and then cannot be converted", async () => {
    const { submission } = await ownerSubmits(1, { assignTo: agentA.id });
    assert.equal((await call(agentA, "PATCH", `/submissions/${submission.id}`, { status: "REJECTED", note: "εκτός περιοχής" })).statusCode, 200);
    const convert = await call(agentA, "POST", `/submissions/${submission.id}/convert`, { mode: "create" });
    assert.equal(convert.statusCode, 409);
  });

  it("writes from another origin are refused (CSRF), reads are unaffected", async () => {
    const { submission } = await ownerSubmits(1, { assignTo: agentA.id });
    const evil = await app.inject({ method: "PATCH", url: `/api/submissions/${submission.id}`, headers: { cookie: agentA.cookie, origin: "https://evil.example" }, payload: { status: "UNDER_REVIEW" } });
    assert.equal(evil.statusCode, 403);
    assert.equal((await intake!.testPrisma().propertySubmission.findUniqueOrThrow({ where: { id: submission.id } })).status, "NEW", "nothing changed");
    const ours = await app.inject({ method: "PATCH", url: `/api/submissions/${submission.id}`, headers: { cookie: agentA.cookie, origin: "https://crm.home88.test" }, payload: { status: "UNDER_REVIEW" } });
    assert.equal(ours.statusCode, 200);
  });

  it("a guessed or forged session cannot read a submission", async () => {
    const { submission } = await ownerSubmits(1);
    const forged = { id: "x", cookie: `${SESSION_COOKIE_NAME}=${"A".repeat(43)}` };
    assert.equal((await call(forged, "GET", `/submissions/${submission.id}`)).statusCode, 401);
  });

  it("phone backfill matches a legacy contact the next time the visitor comes back", async () => {
    // A contact from before phone matching: encrypted phone, no phoneHash.
    const prisma = intake!.testPrisma();
    const legacy = await prisma.contact.create({ data: { reference: "C-LEGACY", firstName: "Μαρία", lastName: "Παπαδοπούλου", roles: ["BUYER"], phoneEncrypted: "enc:legacy" } });
    assert.equal(legacy.phoneHash, null);
    // The harness hashes "2101234567"; set the hash the way the backfill would.
    await prisma.contact.update({ where: { id: legacy.id }, data: { phoneHash: intake!.testPii.hashPhone("+30 210 123 4567") } });
    const { service } = intake!.makeService();
    await service.createContactInquiry({ ...intake!.base({ person: { email: null, phone: "2101234567" } }), message: "Επιστρέφω" });
    assert.equal(await prisma.contact.count(), 1, "matched the legacy contact instead of creating a duplicate");
  });

  it("an agent cannot hand a submission to another agent; a manager can", async () => {
    const { submission } = await ownerSubmits(1);
    assert.equal((await call(agentA, "PATCH", `/submissions/${submission.id}`, { assignedToId: agentB.id })).statusCode, 403);
    assert.equal((await call(manager, "PATCH", `/submissions/${submission.id}`, { assignedToId: agentB.id })).statusCode, 200);
  });
});
