import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

import {
  base,
  DRAFT,
  hasTestDatabase,
  makeService,
  resetDatabase,
  testPrisma,
} from "./testing/harness";
import { createUploadSession, presignUpload, UploadRefused, IntakeValidationError } from "./index";

const SKIP = hasTestDatabase ? false : "INTAKE_TEST_DATABASE_URL not set";

async function photo(width = 800, height = 600, color = { r: 200, g: 120, b: 40 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .withMetadata({
      orientation: 1,
      exif: { IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 58/1 30/1", GPSLongitudeRef: "E", GPSLongitude: "23/1 43/1 15/1" } },
    })
    .toBuffer();
}

describe("PublicLeadIntakeService (real Postgres)", { skip: SKIP }, () => {
  before(async () => {
    await testPrisma().$connect();
  });
  after(async () => {
    await testPrisma().$disconnect();
  });
  beforeEach(resetDatabase);

  const counts = async () => {
    const p = testPrisma();
    const [contacts, leads, submissions, properties, receipts] = await Promise.all([
      p.contact.count(), p.lead.count(), p.propertySubmission.count(), p.property.count(), p.intakeReceipt.count(),
    ]);
    return { contacts, leads, submissions, properties, receipts };
  };

  // ------------------------------------------------------------------ contacts

  it("a new visitor becomes a contact, an unassigned owner lead and a draft submission — never a property", async () => {
    const { service, prisma } = makeService();
    const out = await service.createAssignmentSubmission({ ...base(), property: DRAFT });
    assert.equal(out.status, "created");
    assert.match((out as { reference: string }).reference, /^SUB-\d{4}-000001$/);

    assert.deepEqual(await counts(), { contacts: 1, leads: 1, submissions: 1, properties: 0, receipts: 0 });
    const lead = await prisma.lead.findFirstOrThrow();
    assert.equal(lead.type, "SELLER_OWNER");
    assert.equal(lead.status, "NEW");
    assert.equal(lead.assignedToId, null, "no hard-coded assignee");
    assert.equal(lead.landingPage, "/submit", "query string dropped");
    assert.equal(lead.referrerHost, "google.com");
    assert.equal(lead.sourceChannel, "GOOGLE");
    assert.equal(lead.utmCampaign, null);

    const sub = await prisma.propertySubmission.findFirstOrThrow();
    assert.equal(sub.status, "NEW");
    assert.equal(sub.kind, "ASSIGNMENT");
    assert.equal(sub.leadId, lead.id);
    assert.ok(sub.retentionExpiresAt, "retention is set");

    const contact = await prisma.contact.findFirstOrThrow();
    assert.deepEqual(contact.roles, ["SELLER"]);
    assert.ok(contact.emailEncrypted?.startsWith("enc:") && contact.phoneHash);
    assert.equal(await prisma.crmNotification.count({ where: { kind: "new_assignment", entityType: "SUBMISSION", entityId: sub.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { action: "INTAKE_ASSIGNMENT" } }), 1);
  });

  it("an existing contact is found by email whatever its case, and gains the new role", async () => {
    const { service, prisma } = makeService();
    await service.createContactInquiry({ ...base(), message: "Γεια σας" });
    await service.createBuyerRequest({
      ...base({ person: { email: "  MARIA@Example.com ", phone: null } }),
      request: { listingType: "SALE" },
    });
    assert.equal((await counts()).contacts, 1);
    assert.equal((await counts()).leads, 2);
    const contact = await prisma.contact.findFirstOrThrow();
    assert.deepEqual(contact.roles, ["BUYER"]);
    const leads = await prisma.lead.findMany();
    assert.ok(leads.every((l) => l.contactId === contact.id));
  });

  it("the same phone written differently is the same person", async () => {
    const { service } = makeService();
    await service.createContactInquiry({ ...base({ person: { email: null, phone: "+30 210 123 4567" } }), message: "α" });
    await service.createContactInquiry({ ...base({ person: { email: null, phone: "0030-210-1234567" } }), message: "β" });
    await service.createContactInquiry({ ...base({ person: { email: null, phone: "(210) 123 4567" } }), message: "γ" });
    assert.equal((await counts()).contacts, 1);
    assert.equal((await counts()).leads, 3);
  });

  it("a shared phone with a different surname is not guessed: a flagged new contact for a person to decide", async () => {
    const { service, prisma } = makeService();
    await service.createContactInquiry({ ...base({ person: { email: null, phone: "2101234567", lastName: "Παπαδοπούλου" } }), message: "α" });
    await service.createContactInquiry({ ...base({ person: { email: null, phone: "2101234567", firstName: "Νίκος", lastName: "Γεωργίου" } }), message: "β" });
    assert.equal((await counts()).contacts, 2, "not silently merged");
    assert.equal(await prisma.crmNotification.count({ where: { kind: "possible_duplicate" } }), 1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "POSSIBLE_DUPLICATE" } });
    assert.equal((audit.changes as { matchedOn: string }).matchedOn, "phone");
  });

  it("email and phone pointing at different contacts: email wins and it is flagged", async () => {
    const { service, prisma } = makeService();
    await service.createContactInquiry({ ...base({ person: { email: "a@example.com", phone: null, lastName: "Α" } }), message: "α" });
    await service.createContactInquiry({ ...base({ person: { email: "b@example.com", phone: "2109999999", lastName: "Β" } }), message: "β" });
    await service.createContactInquiry({ ...base({ person: { email: "a@example.com", phone: "2109999999", lastName: "Α" } }), message: "γ" });
    assert.equal((await counts()).contacts, 2);
    const a = await prisma.contact.findFirstOrThrow({ where: { lastName: "Α" } });
    const leads = await prisma.lead.findMany({ orderBy: { createdAt: "asc" } });
    assert.equal(leads[2]!.contactId, a.id);
    assert.equal(await prisma.crmNotification.count({ where: { kind: "possible_duplicate" } }), 1);
  });

  // --------------------------------------------------------------------- flows

  it("a buyer request creates the contact, a BUYER lead and the request, linked", async () => {
    const { service, prisma } = makeService();
    const out = await service.createBuyerRequest({
      ...base(),
      request: { listingType: "SALE", propertyTypes: ["APARTMENT", "BOGUS"], areas: ["Γλυφάδα"], minPrice: 300000, maxPrice: 500000, minBedrooms: 2, features: ["parking", "bad key!"], notes: "Με θέα" },
    });
    assert.equal(out.status, "created");
    const lead = await prisma.lead.findFirstOrThrow({ include: { buyerRequest: true } });
    assert.equal(lead.type, "BUYER");
    assert.equal(lead.buyerRequest?.status, "ACTIVE");
    assert.deepEqual(lead.buyerRequest?.propertyTypes, ["APARTMENT"], "unknown types dropped");
    assert.deepEqual(lead.buyerRequest?.features, ["parking"]);
    assert.equal(Number(lead.budgetMax), 500000);
    assert.equal(lead.buyerRequest?.contactId, lead.contactId);
    assert.match(lead.buyerRequest!.reference, /^ZHT-/);
  });

  it("an inverted budget range is refused and nothing is written", async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.createBuyerRequest({ ...base(), request: { listingType: "SALE", minPrice: 9, maxPrice: 1 } }),
      (e) => e instanceof IntakeValidationError && "maxPrice" in e.fields,
    );
    assert.deepEqual(await counts(), { contacts: 0, leads: 0, submissions: 0, properties: 0, receipts: 0 });
  });

  it("a valuation request is a seller-valuation lead with a VALUATION submission", async () => {
    const { service, prisma } = makeService();
    await service.createValuationRequest({ ...base(), property: DRAFT });
    const lead = await prisma.lead.findFirstOrThrow();
    const sub = await prisma.propertySubmission.findFirstOrThrow();
    assert.equal(lead.type, "SELLER_VALUATION");
    assert.equal(sub.kind, "VALUATION");
  });

  async function seedProperty(reference = "H88-000042") {
    return testPrisma().property.create({
      data: { reference, slug: reference.toLowerCase(), listingType: "SALE", propertyType: "APARTMENT", status: "ACTIVE", titleEl: "Δ", descriptionEl: "Δ", publishedOnWebsite: true },
    });
  }

  it("a property enquiry links contact, lead and property", async () => {
    const { service, prisma } = makeService();
    const property = await seedProperty();
    await service.createPropertyInquiry({ ...base(), propertyReference: "h88-000042", message: "Είναι διαθέσιμο;" });
    const lead = await prisma.lead.findFirstOrThrow();
    assert.equal(lead.type, "PROPERTY_ENQUIRY");
    assert.equal(lead.source, "PROPERTY_ENQUIRY");
    assert.equal(lead.propertyId, property.id);
    assert.ok(lead.contactId);
    assert.equal(await prisma.consentRecord.count({ where: { purpose: "PROPERTY_ENQUIRY", granted: true } }), 1);
  });

  it("an unknown property reference is a validation error and writes nothing", async () => {
    const { service } = makeService();
    await assert.rejects(() => service.createPropertyInquiry({ ...base(), propertyReference: "H88-999999" }), IntakeValidationError);
    assert.deepEqual(await counts(), { contacts: 0, leads: 0, submissions: 0, properties: 0, receipts: 0 });
  });

  it("a viewing request stays a request: no Viewing exists until an agent confirms", async () => {
    const fixed = new Date("2026-10-03T10:00:00Z");
    const { service, prisma } = makeService({ now: () => fixed });
    await seedProperty();
    await service.createViewingRequest({ ...base(), propertyReference: "H88-000042", preferredStart: "2026-10-10T16:00:00Z" });
    const vr = await prisma.viewingRequest.findFirstOrThrow();
    assert.equal(vr.status, "REQUESTED");
    assert.equal(vr.viewingId, null);
    assert.equal(await prisma.viewing.count(), 0);
    assert.equal((await prisma.lead.findFirstOrThrow()).type, "BUYER_VIEWING");
    await assert.rejects(
      () => service.createViewingRequest({ ...base({ person: { email: "x@example.com" } }), propertyReference: "H88-000042", preferredStart: "2026-09-01T10:00:00Z" }),
      (e) => e instanceof IntakeValidationError && "preferredStart" in e.fields,
    );
  });

  it("a contact message folds the subject in; marketing consent is separate from the enquiry", async () => {
    const { service, prisma } = makeService();
    await service.createContactInquiry({ ...base({ consent: { marketing: false } }), subject: "Ερώτηση", message: "Θέλω πληροφορίες" });
    const lead = await prisma.lead.findFirstOrThrow();
    assert.equal(lead.message, "Θέμα: Ερώτηση\n\nΘέλω πληροφορίες");
    const records = await prisma.consentRecord.findMany({ orderBy: { createdAt: "asc" } });
    assert.deepEqual(records.map((r) => [r.purpose, r.granted]).sort(), [["MARKETING", false], ["NECESSARY", true]]);
    assert.equal(lead.consentRecordId, records.find((r) => r.purpose === "MARKETING")!.id);
  });

  it("no consent choice means no marketing record at all — never inferred from the enquiry", async () => {
    const { service, prisma } = makeService();
    await service.createContactInquiry({ ...base(), message: "α" });
    assert.equal(await prisma.consentRecord.count({ where: { purpose: "MARKETING" } }), 0);
  });

  it("campaign tags are stored only when measurement was allowed", async () => {
    const { service, prisma } = makeService();
    const attribution = { landingPage: "/request", utmSource: "instagram", utmMedium: "social", utmCampaign: "spring" };
    await service.createContactInquiry({ ...base({ meta: { ip: "1.1.1.1", userAgent: null, attribution } }), message: "α" });
    await service.createContactInquiry({ ...base({ person: { email: "b@example.com" }, consent: { analytics: true }, meta: { ip: "1.1.1.1", userAgent: null, attribution } }), message: "β" });
    const [first, second] = await prisma.lead.findMany({ orderBy: { createdAt: "asc" } });
    assert.equal(first!.utmCampaign, null);
    assert.equal(second!.utmCampaign, "spring");
    assert.equal(second!.sourceChannel, "INSTAGRAM");
  });

  it("an underage or unconfirmed visitor is refused and nothing is written", async () => {
    const { service } = makeService();
    const out = await service.createContactInquiry({ ...base({ age: { dateOfBirth: "2015-01-01", ageAffirmation: true } }), message: "α" });
    assert.equal(out.status, "refused");
    assert.deepEqual(await counts(), { contacts: 0, leads: 0, submissions: 0, properties: 0, receipts: 0 });
  });

  it("a visitor who gives no date of birth, or only ticks the box, is refused and nothing is written", async () => {
    const { service } = makeService();
    for (const age of [{ ageAffirmation: true }, { dateOfBirth: "", ageAffirmation: true }, { dateOfBirth: "not-a-date", ageAffirmation: true }]) {
      const out = await service.createContactInquiry({ ...base({ age: age as never }), message: "α" });
      assert.equal(out.status, "refused");
    }
    assert.deepEqual(await counts(), { contacts: 0, leads: 0, submissions: 0, properties: 0, receipts: 0 });
  });

  it("a contact with neither email nor a valid phone is refused", async () => {
    const { service } = makeService();
    await assert.rejects(() => service.createContactInquiry({ ...base({ person: { email: null, phone: "abc" } }), message: "α" }), IntakeValidationError);
  });

  // --------------------------------------------------------------- idempotency

  it("a retried submission returns the original reference and creates nothing new", async () => {
    const { service } = makeService();
    const meta = { ip: "1.1.1.1", userAgent: null, idempotencyKey: "key-12345678" };
    const first = await service.createAssignmentSubmission({ ...base({ meta }), property: DRAFT });
    const again = await service.createAssignmentSubmission({ ...base({ meta }), property: DRAFT });
    assert.equal(first.status, "created");
    assert.equal(again.status, "replayed");
    assert.equal((again as { reference: string }).reference, (first as { reference: string }).reference);
    assert.deepEqual(await counts(), { contacts: 1, leads: 1, submissions: 1, properties: 0, receipts: 1 });
  });

  it("five simultaneous identical submissions create exactly one of everything", async () => {
    const { service } = makeService();
    const meta = { ip: "1.1.1.1", userAgent: null, idempotencyKey: "race-key-12345" };
    const results = await Promise.all(Array.from({ length: 5 }, () => service.createAssignmentSubmission({ ...base({ meta }), property: DRAFT })));
    assert.deepEqual(await counts(), { contacts: 1, leads: 1, submissions: 1, properties: 0, receipts: 1 });
    const refs = new Set(results.map((r) => (r as { reference: string }).reference));
    assert.equal(refs.size, 1, "everyone is told the same reference");
    assert.equal(results.filter((r) => r.status === "created").length, 1);
  });

  it("different keys are different submissions", async () => {
    const { service } = makeService();
    for (const key of ["key-aaaaaaaa", "key-bbbbbbbb"]) {
      await service.createContactInquiry({ ...base({ meta: { ip: "1.1.1.1", userAgent: null, idempotencyKey: key } }), message: "α" });
    }
    assert.equal((await counts()).leads, 2);
    assert.equal((await counts()).contacts, 1);
  });

  // ------------------------------------------------------------------- uploads

  async function upload(storage: ReturnType<typeof makeService>["storage"], prisma: ReturnType<typeof testPrisma>, limits: ReturnType<typeof makeService>["limits"], token: string, file: { name: string; mime: string; body: Buffer; kind?: "PHOTO" | "DOCUMENT" }) {
    const kind = file.kind ?? "PHOTO";
    const { storageKey } = await presignUpload({ prisma, storage, limits }, token, { kind, mimeType: file.mime, fileName: file.name, byteSize: file.body.length });
    storage.upload(storageKey, file.body, file.mime); // what the browser's PUT does
    return { storageKey, kind, fileName: file.name, mimeType: file.mime, byteSize: file.body.length };
  }

  it("five photos upload, are processed and arrive private and pending review", async () => {
    const { service, storage, prisma, limits } = makeService();
    const session = await createUploadSession(prisma);
    const files: Awaited<ReturnType<typeof upload>>[] = [];
    for (let i = 0; i < 5; i++) files.push(await upload(storage, prisma, limits, session.token, { name: `foto${i}.jpg`, mime: "image/jpeg", body: await photo(800 + i, 600, { r: 10 * i, g: 50, b: 90 }) }));
    const out = await service.createAssignmentSubmission({ ...base(), property: DRAFT, uploads: { token: session.token, files } });
    assert.equal(out.status, "created");
    assert.deepEqual((out as { uploads: unknown }).uploads, { accepted: 5, quarantined: 0, rejected: 0, skipped: 0 });

    const media = await prisma.propertyMedia.findMany({ orderBy: { sortOrder: "asc" } });
    assert.equal(media.length, 5);
    for (const m of media) {
      assert.equal(m.propertyId, null, "not attached to any property");
      assert.equal(m.status, "pending_review");
      assert.equal(m.lifecycle, "AVAILABLE");
      assert.equal(m.source, "OWNER_SUBMISSION");
      assert.equal(m.isPrimary, false);
      assert.ok(m.checksum && m.thumbnailKey && m.previewKey);
      assert.match(m.storageKey, /^submissions\/[a-f0-9]{32}\/uploads\//);
      assert.ok(storage.objects.has(m.thumbnailKey!));
      const stored = storage.objects.get(m.storageKey)!.body;
      assert.equal((await sharp(stored).metadata()).exif, undefined, "stored master has no EXIF/GPS");
    }
    assert.equal(await prisma.property.count(), 0);
    assert.ok((await prisma.intakeUploadSession.findFirstOrThrow()).submissionId, "session is claimed");
  });

  it("a script renamed .jpg is rejected: its object is deleted and nothing becomes media", async () => {
    const { service, storage, prisma, limits } = makeService();
    const session = await createUploadSession(prisma);
    const evil = await upload(storage, prisma, limits, session.token, { name: "a.jpg", mime: "image/jpeg", body: Buffer.from("<?php system($_GET['c']); ?>") });
    const good = await upload(storage, prisma, limits, session.token, { name: "b.jpg", mime: "image/jpeg", body: await photo() });
    const out = await service.createAssignmentSubmission({ ...base(), property: DRAFT, uploads: { token: session.token, files: [evil, good] } });
    assert.deepEqual((out as { uploads: unknown }).uploads, { accepted: 1, quarantined: 0, rejected: 1, skipped: 0 });
    assert.equal(storage.objects.has(evil.storageKey), false, "unsafe object removed");
    const rows = await prisma.propertyMedia.findMany({ orderBy: { sortOrder: "asc" } });
    assert.deepEqual(rows.map((r) => r.lifecycle), ["REJECTED", "AVAILABLE"]);
    assert.match(rows[0]!.processingNote!, /does not match/);
  });

  it("a real image that is too small is quarantined for staff, not lost", async () => {
    const { service, storage, prisma, limits } = makeService({ limits: { minDimension: 500 } });
    const session = await createUploadSession(prisma);
    const tiny = await upload(storage, prisma, limits, session.token, { name: "t.jpg", mime: "image/jpeg", body: await photo(200, 150) });
    const out = await service.createAssignmentSubmission({ ...base(), property: DRAFT, uploads: { token: session.token, files: [tiny] } });
    assert.deepEqual((out as { uploads: unknown }).uploads, { accepted: 0, quarantined: 1, rejected: 0, skipped: 0 });
    const row = await prisma.propertyMedia.findFirstOrThrow();
    assert.equal(row.lifecycle, "QUARANTINED");
    assert.match(row.processingNote!, /smaller than 500px/);
    assert.equal(storage.objects.has(tiny.storageKey), true, "kept for review");
  });

  it("oversized and disguised uploads never get a signed URL", async () => {
    const { storage, prisma, limits } = makeService({ limits: { maxPhotoBytes: 1000 } });
    const session = await createUploadSession(prisma);
    const declare = (over: object) => presignUpload({ prisma, storage, limits }, session.token, { kind: "PHOTO", mimeType: "image/jpeg", fileName: "a.jpg", byteSize: 500, ...over });
    await assert.rejects(() => declare({ byteSize: 1001 }), (e) => e instanceof UploadRefused && e.code === "TOO_LARGE");
    await assert.rejects(() => declare({ mimeType: "image/svg+xml", fileName: "a.svg" }), (e) => e instanceof UploadRefused && e.code === "TYPE_NOT_ALLOWED");
    await assert.rejects(() => declare({ fileName: "a.php.jpg" }), (e) => e instanceof UploadRefused && e.code === "BLOCKED_NAME");
    await assert.rejects(() => declare({ fileName: "a.png" }), (e) => e instanceof UploadRefused && e.code === "EXTENSION_MISMATCH");
    await assert.rejects(() => presignUpload({ prisma, storage, limits }, "x".repeat(43), { kind: "PHOTO", mimeType: "image/jpeg", fileName: "a.jpg", byteSize: 5 }), (e) => e instanceof UploadRefused && e.code === "SESSION_INVALID");
    assert.equal(storage.objects.size, 0);
  });

  it("a browser that sends more bytes than it declared is rejected at claim time", async () => {
    const { service, storage, prisma, limits } = makeService();
    const session = await createUploadSession(prisma);
    const real = await photo();
    const { storageKey } = await presignUpload({ prisma, storage, limits }, session.token, { kind: "PHOTO", mimeType: "image/jpeg", fileName: "a.jpg", byteSize: 1000 });
    storage.upload(storageKey, real, "image/jpeg"); // far more than 1000 bytes
    const out = await service.createAssignmentSubmission({ ...base(), property: DRAFT, uploads: { token: session.token, files: [{ storageKey, kind: "PHOTO", fileName: "a.jpg", mimeType: "image/jpeg", byteSize: 1000 }] } });
    assert.equal((out as { uploads: { rejected: number } }).uploads.rejected, 1);
    assert.equal(await prisma.propertyMedia.count({ where: { lifecycle: "AVAILABLE" } }), 0);
  });

  it("quotas stop an anonymous visitor at the configured number of files and bytes", async () => {
    const { storage, prisma, limits } = makeService({ limits: { maxPhotos: 2, maxTotalBytes: 5000 } });
    const session = await createUploadSession(prisma);
    const ask = (size = 1000) => presignUpload({ prisma, storage, limits }, session.token, { kind: "PHOTO", mimeType: "image/jpeg", fileName: "a.jpg", byteSize: size });
    await ask();
    await ask();
    await assert.rejects(() => ask(), (e) => e instanceof UploadRefused && e.code === "QUOTA_FILES");
    const second = await createUploadSession(prisma);
    await assert.rejects(() => presignUpload({ prisma, storage, limits }, second.token, { kind: "PHOTO", mimeType: "image/jpeg", fileName: "a.jpg", byteSize: 6000 }), (e) => e instanceof UploadRefused && (e.code === "TOO_LARGE" || e.code === "QUOTA_BYTES"));
  });

  it("parallel presign requests cannot overshoot the quota", async () => {
    const { storage, prisma, limits } = makeService({ limits: { maxPhotos: 3 } });
    const session = await createUploadSession(prisma);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => presignUpload({ prisma, storage, limits }, session.token, { kind: "PHOTO", mimeType: "image/jpeg", fileName: "a.jpg", byteSize: 100 })),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
  });

  it("a visitor cannot claim someone else's upload", async () => {
    const { service, storage, prisma, limits } = makeService();
    const mine = await createUploadSession(prisma);
    const theirs = await createUploadSession(prisma);
    const stolen = await upload(storage, prisma, limits, theirs.token, { name: "p.jpg", mime: "image/jpeg", body: await photo() });
    const out = await service.createAssignmentSubmission({ ...base(), property: DRAFT, uploads: { token: mine.token, files: [stolen] } });
    assert.equal((out as { uploads: { rejected: number } }).uploads.rejected, 1);
    assert.equal(await prisma.propertyMedia.count(), 0);
    assert.equal(storage.objects.has(stolen.storageKey), true, "the other visitor's object is untouched");
  });

  it("private documents become CRM-only Document rows and never property media", async () => {
    const { service, storage, prisma, limits } = makeService();
    const session = await createUploadSession(prisma);
    const pdf = await upload(storage, prisma, limits, session.token, { name: "titlos.pdf", mime: "application/pdf", kind: "DOCUMENT", body: Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\n") });
    await service.createAssignmentSubmission({ ...base(), property: DRAFT, uploads: { token: session.token, files: [pdf] } });
    assert.equal(await prisma.propertyMedia.count(), 0);
    const doc = await prisma.document.findFirstOrThrow();
    assert.equal(doc.propertyId, null);
    assert.equal(doc.containsPersonalData, true);
    assert.equal(doc.source, "OWNER_SUBMISSION");
    assert.ok(doc.contactId && doc.submissionId);
  });

  it("the same photo twice is flagged, never silently dropped", async () => {
    const { service, storage, prisma, limits } = makeService();
    const session = await createUploadSession(prisma);
    const body = await photo();
    const a = await upload(storage, prisma, limits, session.token, { name: "a.jpg", mime: "image/jpeg", body });
    const b = await upload(storage, prisma, limits, session.token, { name: "b.jpg", mime: "image/jpeg", body });
    await service.createAssignmentSubmission({ ...base(), property: DRAFT, uploads: { token: session.token, files: [a, b] } });
    const rows = await prisma.propertyMedia.findMany({ orderBy: { sortOrder: "asc" } });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.processingNote, null);
    assert.match(rows[1]!.processingNote!, /διπλότυπο/);
  });

  it("a storage failure mid-batch loses nothing: the retry completes the rest without duplicates", async () => {
    const { service, storage, prisma, limits } = makeService();
    const session = await createUploadSession(prisma);
    const files: Awaited<ReturnType<typeof upload>>[] = [];
    for (let i = 0; i < 3; i++) files.push(await upload(storage, prisma, limits, session.token, { name: `f${i}.jpg`, mime: "image/jpeg", body: await photo(800 + i) }));

    // The second file's write fails once, as if storage hiccuped.
    const realPut = storage.put.bind(storage);
    let failed = false;
    storage.put = async (key: string, body: Buffer, type: string) => {
      if (!failed && key === files[1]!.storageKey) {
        failed = true;
        throw new Error("storage hiccup");
      }
      return realPut(key, body, type);
    };

    const meta = { ip: "1.1.1.1", userAgent: null, idempotencyKey: "retry-key-1234" };
    const first = await service.createAssignmentSubmission({ ...base({ meta }), property: DRAFT, uploads: { token: session.token, files } });
    assert.deepEqual((first as { uploads: unknown }).uploads, { accepted: 2, quarantined: 0, rejected: 0, skipped: 1 });
    assert.equal(await prisma.propertyMedia.count(), 2);

    // The browser retries the same POST.
    const again = await service.createAssignmentSubmission({ ...base({ meta }), property: DRAFT, uploads: { token: session.token, files } });
    assert.equal(again.status, "replayed");
    assert.deepEqual((again as { uploads: unknown }).uploads, { accepted: 1, quarantined: 0, rejected: 0, skipped: 2 });
    assert.equal(await prisma.propertyMedia.count(), 3, "all three, exactly once each");
    assert.deepEqual(await counts(), { contacts: 1, leads: 1, submissions: 1, properties: 0, receipts: 1 });
  });

  // -------------------------------------------------------------- conversion

  it("converting moves the same media rows to the property's public prefix, keeps documents private, and publishes nothing", async () => {
    const { service, storage, prisma, limits } = makeService();
    const { convertSubmission } = await import("./index");
    const staff = await prisma.user.create({ data: { email: "agent@home88.test", firstName: "Άγγελος", lastName: "Σύμβουλος", role: "AGENT", status: "ACTIVE" } as never });

    const session = await createUploadSession(prisma);
    const photos: Awaited<ReturnType<typeof upload>>[] = [];
    for (let i = 0; i < 3; i++) photos.push(await upload(storage, prisma, limits, session.token, { name: `f${i}.jpg`, mime: "image/jpeg", body: await photo(800 + i) }));
    const pdf = await upload(storage, prisma, limits, session.token, { name: "t.pdf", mime: "application/pdf", kind: "DOCUMENT", body: Buffer.from("%PDF-1.7\n") });
    await service.createAssignmentSubmission({ ...base(), property: DRAFT, uploads: { token: session.token, files: [...photos, pdf] } });

    const before = await prisma.propertyMedia.findMany({ orderBy: { sortOrder: "asc" } });
    const sub = await prisma.propertySubmission.findFirstOrThrow();
    const out = await convertSubmission({ prisma, storage }, { submissionId: sub.id, actorId: staff.id, mode: { type: "create", overrides: { price: 430000 } } });
    assert.equal(out.attachedPhotos, 3);

    const property = await prisma.property.findUniqueOrThrow({ where: { id: out.propertyId } });
    assert.equal(property.status, "DRAFT");
    assert.equal(property.publishedOnWebsite, false);
    assert.equal(Number(property.price), 430000, "agent's override wins");
    assert.equal(property.titleEl, DRAFT.titleEl, "prepopulated from the submission");
    assert.equal(property.ownerId, sub.contactId);

    const after = await prisma.propertyMedia.findMany({ orderBy: { sortOrder: "asc" } });
    assert.deepEqual(after.map((m) => m.id), before.map((m) => m.id), "same rows: nothing duplicated");
    for (const m of after) {
      assert.equal(m.propertyId, property.id);
      assert.match(m.storageKey, new RegExp(`^properties/${property.id}/photo/\\d{4}/\\d{2}/`));
      assert.equal(m.status, "pending_review", "still not public");
      assert.equal(m.isPrimary, false);
      assert.ok(storage.objects.has(m.storageKey) && storage.objects.has(m.thumbnailKey!));
    }
    for (const m of before) assert.equal(storage.objects.has(m.storageKey), false, "private copy removed after commit");
    assert.equal([...storage.objects.keys()].filter((k) => k.startsWith("submissions/") && !k.endsWith(".pdf")).length, 0);

    const doc = await prisma.document.findFirstOrThrow();
    assert.equal(doc.propertyId, property.id, "linked for staff");
    assert.match(doc.storageKey, /^submissions\//, "still in the private prefix");
    assert.equal(await prisma.propertyMedia.count({ where: { kind: "DOCUMENT" } }), 0);

    const updated = await prisma.propertySubmission.findUniqueOrThrow({ where: { id: sub.id } });
    assert.equal(updated.status, "PROPERTY_CREATED");
    assert.equal(updated.propertyId, property.id);
    await assert.rejects(() => convertSubmission({ prisma, storage }, { submissionId: sub.id, actorId: staff.id, mode: { type: "create" } }), /ήδη/);
  });

  it("an agent can link a submission to an existing property instead of creating one", async () => {
    const { service, storage, prisma, limits } = makeService();
    const { convertSubmission } = await import("./index");
    const staff = await prisma.user.create({ data: { email: "a2@home88.test", firstName: "Α", lastName: "Β", role: "AGENT", status: "ACTIVE" } as never });
    const existing = await seedProperty("H88-000500");
    const session = await createUploadSession(prisma);
    const f = await upload(storage, prisma, limits, session.token, { name: "f.jpg", mime: "image/jpeg", body: await photo() });
    await service.createAssignmentSubmission({ ...base(), property: DRAFT, uploads: { token: session.token, files: [f] } });
    const sub = await prisma.propertySubmission.findFirstOrThrow();
    const out = await convertSubmission({ prisma, storage }, { submissionId: sub.id, actorId: staff.id, mode: { type: "link", propertyId: existing.id } });
    assert.equal(out.propertyId, existing.id);
    assert.equal(await prisma.property.count(), 1, "no second property");
    assert.equal((await prisma.propertyMedia.findFirstOrThrow()).propertyId, existing.id);
    await assert.rejects(() => convertSubmission({ prisma, storage }, { submissionId: sub.id, actorId: staff.id, mode: { type: "link", propertyId: "nope" } }), /ήδη/);
  });

  it("a rejected submission cannot be converted, and quarantined photos are never attached", async () => {
    const { service, storage, prisma, limits } = makeService({ limits: { minDimension: 500 } });
    const { convertSubmission, setSubmissionStatus } = await import("./index");
    const staff = await prisma.user.create({ data: { email: "a3@home88.test", firstName: "Α", lastName: "Γ", role: "MANAGER", status: "ACTIVE" } as never });
    const session = await createUploadSession(prisma);
    const tiny = await upload(storage, prisma, limits, session.token, { name: "t.jpg", mime: "image/jpeg", body: await photo(200, 150) });
    const big = await upload(storage, prisma, limits, session.token, { name: "b.jpg", mime: "image/jpeg", body: await photo(800, 600) });
    await service.createAssignmentSubmission({ ...base(), property: DRAFT, uploads: { token: session.token, files: [tiny, big] } });
    const sub = await prisma.propertySubmission.findFirstOrThrow();
    const out = await convertSubmission({ prisma, storage }, { submissionId: sub.id, actorId: staff.id, mode: { type: "create" } });
    assert.equal(out.attachedPhotos, 1, "the quarantined file stays behind");
    assert.equal(await prisma.propertyMedia.count({ where: { propertyId: null } }), 1);

    const { service: s2 } = makeService();
    await s2.createValuationRequest({ ...base({ person: { email: "z@example.com", phone: null } }), property: DRAFT });
    const second = await prisma.propertySubmission.findFirstOrThrow({ where: { kind: "VALUATION" } });
    await setSubmissionStatus(prisma, { submissionId: second.id, to: "REJECTED", actorId: staff.id, note: "εκτός περιοχής" });
    await assert.rejects(() => convertSubmission({ prisma, storage }, { submissionId: second.id, actorId: staff.id, mode: { type: "create" } }), /απορρι/);
  });

  it("status changes follow the workflow and PUBLISHED needs a really public property", async () => {
    const { service, prisma } = makeService();
    const { setSubmissionStatus, canTransition } = await import("./index");
    const staff = await prisma.user.create({ data: { email: "a4@home88.test", firstName: "Α", lastName: "Δ", role: "MANAGER", status: "ACTIVE" } as never });
    await service.createAssignmentSubmission({ ...base(), property: DRAFT });
    const sub = await prisma.propertySubmission.findFirstOrThrow();
    await setSubmissionStatus(prisma, { submissionId: sub.id, to: "UNDER_REVIEW", actorId: staff.id });
    await setSubmissionStatus(prisma, { submissionId: sub.id, to: "CONTACTED", actorId: staff.id, assignedToId: staff.id });
    assert.equal((await prisma.propertySubmission.findFirstOrThrow()).assignedToId, staff.id);
    await assert.rejects(() => setSubmissionStatus(prisma, { submissionId: sub.id, to: "PROPERTY_CREATED", actorId: staff.id }), /μετατροπή/);
    await assert.rejects(() => setSubmissionStatus(prisma, { submissionId: sub.id, to: "PUBLISHED", actorId: staff.id }), /Δεν επιτρέπεται/);
    assert.equal(canTransition("NEW", "PUBLISHED"), false);
    assert.equal(canTransition("ARCHIVED", "NEW"), false);
    assert.equal(canTransition("NEW", "REJECTED"), true);
  });
});
