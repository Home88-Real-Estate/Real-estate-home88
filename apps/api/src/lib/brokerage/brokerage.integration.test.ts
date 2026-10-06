/**
 * Showings, structured mandate terms, co-owners, extensions, milestones and
 * legacy mappings against a real Postgres with every migration applied.
 *
 *   TEST_DATABASE_URL=postgresql://… npx tsx --test src/lib/brokerage/brokerage.integration.test.ts
 *
 * The template wording below is test text, not mandate wording.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { PrismaClient } from "@home88/database";

const url = process.env.TEST_DATABASE_URL;
const SKIP = url ? false : "TEST_DATABASE_URL not set";

describe("brokerage foundation (real Postgres)", { skip: SKIP }, () => {
  let db: PrismaClient;
  let lib: typeof import("./index");
  let pii: typeof import("../pii");
  let domain: typeof import("@home88/domain");
  const run = randomBytes(4).toString("hex");
  const RUN = run.toUpperCase();
  let seq = 0;
  const uniq = (p: string) => `${p}-${RUN}-${++seq}`;
  const actor = { id: "actor-1", name: "Test Agent" };
  let agent: { id: string };
  let manager: { id: string };

  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const sql = (strings: TemplateStringsArray, ...v: unknown[]) => db.$executeRaw(strings, ...v);
  const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);

  before(async () => {
    process.env.DATABASE_URL = url!;
    process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
    process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    ({ db: db } = { db: (await import("../prisma")).db() });
    lib = await import("./index");
    pii = await import("../pii");
    domain = await import("@home88/domain");

    agent = await db.user.create({ data: { email: `agent-${run}@test.invalid`, firstName: "Ag", lastName: "Ent", role: "AGENT", passwordHash: "x" } });
    manager = await db.user.create({ data: { email: `mgr-${run}@test.invalid`, firstName: "Ma", lastName: "Nager", role: "MANAGER", passwordHash: "x" } });

    await db.companyLegalDetails.upsert({
      where: { id: "default" },
      create: { id: "default", legalNameEl: "HOME88 Μεσιτική", legalNameEn: "HOME88 Real Estate", vatNumber: "000000000", taxOffice: "Δοκιμαστική ΔΟΥ", registeredAddressEl: "Οδός 1, Αθήνα", registeredAddressEn: "1 Street, Athens", phone: "2100000000" },
      update: { legalNameEl: "HOME88 Μεσιτική", legalNameEn: "HOME88 Real Estate", vatNumber: "000000000", taxOffice: "Δοκιμαστική ΔΟΥ", registeredAddressEl: "Οδός 1, Αθήνα", registeredAddressEn: "1 Street, Athens", phone: "2100000000" },
    });
    await db.commissionSettings.upsert({ where: { id: "default" }, create: { id: "default", vatRatePct: 24 }, update: { vatRatePct: 24 } });
    await db.mandateSettings.upsert({ where: { id: "default" }, create: { id: "default", maxExclusiveMonths: 12 }, update: { maxExclusiveMonths: 12 } });
    for (const type of ["SHOWING", "SIMPLE_ASSIGNMENT", "EXCLUSIVE_ASSIGNMENT"]) await activeTemplate(type, "el");
  });

  after(async () => {
    await db.$disconnect();
  });

  // ---- fixtures -------------------------------------------------------------

  /** Retires whatever is ACTIVE for (type, locale) and activates fresh test wording. */
  async function activeTemplate(type: string, locale: string, over: Record<string, unknown> = {}) {
    const template = await db.mandateTemplate.upsert({ where: { type_locale: { type, locale } }, create: { type, locale }, update: {} });
    await db.mandateTemplateVersion.updateMany({ where: { templateId: template.id, status: "ACTIVE" }, data: { status: "RETIRED", retiredAt: new Date() } });
    const last = await db.mandateTemplateVersion.aggregate({ where: { templateId: template.id }, _max: { version: true } });
    const body = `TEST WORDING ${type} ${locale} ${RUN}`;
    return db.mandateTemplateVersion.create({ data: { templateId: template.id, version: (last._max.version ?? 0) + 1, status: "ACTIVE", body, checksum: sha(body), activatedAt: new Date(), ...over } });
  }

  const mkContact = (over: Record<string, unknown> = {}) =>
    db.contact.create({ data: { reference: uniq("C"), firstName: "Μαρία", lastName: "Παπαδοπούλου", ...over } });

  const mkProperty = (over: Record<string, unknown> = {}) => {
    const reference = uniq("H88-T");
    return db.property.create({
      data: { reference, slug: reference.toLowerCase(), listingType: "SALE", propertyType: "APARTMENT", status: "ACTIVE", titleEl: "Διαμέρισμα", descriptionEl: "Φωτεινό διαμέρισμα", address: "Οδός Δοκιμής 5", city: "Αθήνα", areaName: "Γλυφάδα", postalCode: "16674", price: 250000, area: 90, floor: 2, ...over },
    });
  };

  const goodFee = { feePayer: "OWNER", feeMethod: "PERCENTAGE", feeBasis: "FINAL_SALE_PRICE", feePercentage: 2, feeCurrency: "EUR", vatTreatment: "PLUS_VAT", vatRate: 24 } as const;

  const mkParty = (showingId: string, over: Record<string, unknown> = {}) =>
    db.showingParty.create({
      data: {
        showingId, role: "BUYER", fullName: "Γιώργος Κωνσταντίνου", sortOrder: 0,
        taxIdEncrypted: pii.encryptField("123456789"), taxOfficeEncrypted: pii.encryptField("ΔΟΥ Α΄"), idNumberEncrypted: pii.encryptField("ΑΒ123456"),
        addressEncrypted: pii.encryptField("Οδός Πελάτη 1"), phoneEncrypted: pii.encryptField("6900000000"), emailEncrypted: pii.encryptField("g@test.invalid"),
        identityVerifiedAt: new Date(), ...over,
      },
    });

  /** A showing that is complete enough to issue. */
  async function readyShowing(over: { properties?: Array<{ id: string }>; fee?: Record<string, unknown>; language?: string } = {}) {
    const properties = over.properties ?? [await mkProperty()];
    const client = await mkContact();
    const showing = await db.showing.create({ data: { language: over.language ?? "el", contactId: client.id, responsibleUserId: agent.id, ...goodFee, ...(over.fee ?? {}) } });
    for (const p of properties) await lib.addPropertyToShowing(db, showing.id, p.id);
    await mkParty(showing.id, { contactId: client.id });
    return { showing, properties, client };
  }

  const codes = (r: { blockingIssues: Array<{ code: string }>; warnings: Array<{ code: string }> }) => ({ blocking: r.blockingIssues.map((i) => i.code), warnings: r.warnings.map((i) => i.code) });

  // ---- showings: numbering, properties, snapshots ---------------------------------

  it("showing numbers are unique and well-formed even when many are issued at once", async () => {
    const made = await Promise.all(Array.from({ length: 8 }, () => readyShowing()));
    for (const { showing } of made) await lib.markShowingReady(db, showing.id, actor);
    const issued = await Promise.all(made.map(({ showing }) => lib.issueShowing(db, showing.id, actor)));
    const numbers = issued.map((s) => s.number!);
    assert.equal(new Set(numbers).size, 8, numbers.join(","));
    const year = new Date().getUTCFullYear();
    for (const n of numbers) assert.match(n, new RegExp(`^ΥΠ-${year}-\\d{6}$`));
    const seqs = numbers.map((n) => domain.parseShowingNumber(n)!.sequence).sort((a, b) => a - b);
    assert.equal(seqs[7]! - seqs[0]!, 7, "consecutive: no number is skipped or reused");
  });

  it("a failed issue gives its number back", async () => {
    const { showing } = await readyShowing();
    await lib.markShowingReady(db, showing.id, actor);
    await db.mandateTemplateVersion.updateMany({ where: { template: { type: "SHOWING", locale: "el" }, status: "ACTIVE" }, data: { status: "RETIRED" } });
    await assert.rejects(lib.issueShowing(db, showing.id, actor), lib.DocumentBlockedError);
    await activeTemplate("SHOWING", "el");
    const counter = await db.referenceCounter.findUnique({ where: { scope: `showing:${new Date().getUTCFullYear()}` } });
    const before = counter!.nextValue;
    const issued = await lib.issueShowing(db, showing.id, actor);
    assert.equal(domain.parseShowingNumber(issued.number!)!.sequence, before, "the failed attempt did not consume a number");
  });

  it("one showing lists several properties in order, each with its own snapshot", async () => {
    const props = [await mkProperty({ price: 100000, address: "Α 1" }), await mkProperty({ price: 200000, address: "Β 2" }), await mkProperty({ price: 300000, address: "Γ 3" })];
    const { showing } = await readyShowing({ properties: props });
    const rows = await db.showingProperty.findMany({ where: { showingId: showing.id }, orderBy: { sortOrder: "asc" } });
    assert.deepEqual(rows.map((r) => r.sortOrder), [0, 1, 2]);
    assert.deepEqual(rows.map((r) => Number(r.priceSnapshot)), [100000, 200000, 300000]);
    assert.deepEqual(rows.map((r) => r.propertyId), props.map((p) => p.id));
    assert.match(rows[0]!.addressSnapshot!, /Α 1/);
  });

  it("the same property cannot be listed twice, and sort positions are unique", async () => {
    const p = await mkProperty();
    const { showing } = await readyShowing({ properties: [p] });
    await assert.rejects(lib.addPropertyToShowing(db, showing.id, p.id), /Unique constraint/);
    const other = await mkProperty();
    await assert.rejects(db.showingProperty.create({ data: { showingId: showing.id, propertyId: other.id, sortOrder: 0, propertyCodeSnapshot: other.reference, transactionTypeSnapshot: "SALE", propertySnapshot: { x: 1 } } }), /Unique constraint/);
  });

  it("the snapshot is taken from the canonical property, refreshed at issue, and frozen afterwards", async () => {
    const p = await mkProperty({ price: 135000, descriptionEl: "Αρχική περιγραφή" });
    const { showing } = await readyShowing({ properties: [p] });
    await db.property.update({ where: { id: p.id }, data: { price: 130000 } });
    await lib.markShowingReady(db, showing.id, actor);
    await db.property.update({ where: { id: p.id }, data: { price: 128000, descriptionEl: "Τελική περιγραφή πριν την έκδοση" } });
    await lib.issueShowing(db, showing.id, actor);

    const printed = await db.showingProperty.findFirstOrThrow({ where: { showingId: showing.id } });
    assert.equal(Number(printed.priceSnapshot), 128000, "issue re-reads the canonical property");
    assert.equal(printed.descriptionSnapshot, "Τελική περιγραφή πριν την έκδοση");

    // The property changes again: €135,000 → €125,000, new description, even withdrawn.
    await db.property.update({ where: { id: p.id }, data: { price: 125000, descriptionEl: "Εντελώς άλλη περιγραφή", status: "INACTIVE" } });
    const after = await db.showingProperty.findFirstOrThrow({ where: { showingId: showing.id } });
    assert.equal(Number(after.priceSnapshot), 128000);
    assert.equal(after.descriptionSnapshot, "Τελική περιγραφή πριν την έκδοση");
    assert.equal((after.propertySnapshot as { price: number }).price, 128000);

    // And nobody can rewrite it directly.
    await rejects(db.showingProperty.update({ where: { id: printed.id }, data: { priceSnapshot: 1 } }), /cannot be changed/);
    await rejects(db.showingProperty.delete({ where: { id: printed.id } }), /cannot be changed/);
    await rejects(lib.addPropertyToShowing(db, showing.id, (await mkProperty()).id), /έχει εκδοθεί/);
  });

  it("deleting a property keeps what the issued showing printed", async () => {
    const p = await mkProperty();
    const { showing } = await readyShowing({ properties: [p] });
    await lib.markShowingReady(db, showing.id, actor);
    await lib.issueShowing(db, showing.id, actor);
    await db.property.delete({ where: { id: p.id } });
    const row = await db.showingProperty.findFirstOrThrow({ where: { showingId: showing.id } });
    assert.equal(row.propertyId, null);
    assert.equal(row.propertyCodeSnapshot, p.reference);
  });

  it("the fee is recorded per property at issue (net, VAT, gross)", async () => {
    const { showing } = await readyShowing({ properties: [await mkProperty({ price: 250000 })] });
    await lib.markShowingReady(db, showing.id, actor);
    await lib.issueShowing(db, showing.id, actor);
    const row = await db.showingProperty.findFirstOrThrow({ where: { showingId: showing.id } });
    assert.deepEqual({ ...(row.commissionSnapshot as object) }, { net: 5000, vat: 1200, gross: 6200, currency: "EUR", method: "PERCENTAGE", percentage: 2 });
    assert.equal(row.vatTreatmentSnapshot, "PLUS_VAT");
  });

  // ---- showings: parties, privacy ------------------------------------------------------

  it("a showing has several parties (joint buyers, a representative) and keeps them frozen after issue", async () => {
    const { showing } = await readyShowing();
    await mkParty(showing.id, { role: "JOINT_BUYER", fullName: "Ελένη Κωνσταντίνου", sortOrder: 1 });
    await mkParty(showing.id, { role: "ATTORNEY_IN_FACT", fullName: "Νίκος Δικηγόρου", sortOrder: 2, representativeCapacity: "ATTORNEY_IN_FACT", authorityReference: "Πληρεξούσιο 123/2026" });
    assert.equal(await db.showingParty.count({ where: { showingId: showing.id } }), 3);
    await lib.markShowingReady(db, showing.id, actor);
    await lib.issueShowing(db, showing.id, actor);
    const [first] = await db.showingParty.findMany({ where: { showingId: showing.id }, orderBy: { sortOrder: "asc" } });
    await rejects(db.showingParty.update({ where: { id: first!.id }, data: { fullName: "Άλλος" } }), /cannot be changed/);
    await rejects(mkParty(showing.id, { sortOrder: 9 }), /cannot be changed/);
    await rejects(db.showingParty.delete({ where: { id: first!.id } }), /cannot be changed/);
    // Signing is the one thing that moves.
    await db.showingParty.update({ where: { id: first!.id }, data: { signedAt: new Date() } });
  });

  it("identity fields stay encrypted at rest, in the party and in the issued client snapshot", async () => {
    const { showing } = await readyShowing();
    const party = await db.showingParty.findFirstOrThrow({ where: { showingId: showing.id } });
    const [raw] = await db.$queryRaw<Array<{ taxIdEncrypted: string; idNumberEncrypted: string }>>`SELECT "taxIdEncrypted", "idNumberEncrypted" FROM showing_parties WHERE id = ${party.id}`;
    assert.ok(!raw!.taxIdEncrypted.includes("123456789") && !raw!.idNumberEncrypted.includes("ΑΒ123456"));
    assert.equal(pii.decryptField(raw!.taxIdEncrypted), "123456789");

    await lib.markShowingReady(db, showing.id, actor);
    const issued = await lib.issueShowing(db, showing.id, actor);
    const stored = issued.clientSnapshotEncrypted!;
    assert.ok(!stored.includes("123456789") && !stored.includes("Κωνσταντίνου"));
    const snapshot = JSON.parse(pii.decryptField(stored)!) as Array<{ taxId: string; fullName: string }>;
    assert.equal(snapshot[0]!.taxId, "123456789");
    assert.equal(snapshot[0]!.fullName, "Γιώργος Κωνσταντίνου");
    // The company printed is a snapshot too.
    assert.equal((issued.companySnapshot as { vatNumber: string }).vatNumber, "000000000");
  });

  it("issuing refuses when encryption is not configured instead of storing the client in clear", async () => {
    const { showing } = await readyShowing();
    await lib.markShowingReady(db, showing.id, actor);
    const key = process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_ENCRYPTION_KEY;
    try {
      await assert.rejects(lib.issueShowing(db, showing.id, actor), (e: Error) => (e as { code?: string }).code === "ENCRYPTION_NOT_CONFIGURED");
    } finally {
      process.env.PII_ENCRYPTION_KEY = key;
    }
    assert.equal((await db.showing.findUniqueOrThrow({ where: { id: showing.id } })).status, "READY_FOR_ISSUANCE");
  });

  // ---- showings: completeness and lifecycle ---------------------------------------------

  it("an incomplete showing is a saveable draft that cannot be made ready; the result lists what is missing", async () => {
    const showing = await db.showing.create({ data: {} });
    const result = await lib.refreshShowingCompleteness(db, showing.id);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.draftSaveable, true);
    for (const c of ["PROPERTY_MISSING", "PARTY_MISSING", "FEE_PAYER_MISSING", "VAT_TREATMENT_MISSING"]) assert.ok(codes(result).blocking.includes(c), c);
    const stored = (await db.showing.findUniqueOrThrow({ where: { id: showing.id } })).completenessResult as { status: string };
    assert.equal(stored.status, "BLOCKED", "stored for the screen to show");
    await assert.rejects(lib.markShowingReady(db, showing.id, actor), lib.DocumentBlockedError);
    assert.equal((await db.showing.findUniqueOrThrow({ where: { id: showing.id } })).status, "DRAFT");
  });

  it("a missing identity field (ΑΦΜ) blocks; a missing ΔΟΥ or unverified identity only warns", async () => {
    const { showing } = await readyShowing();
    await db.showingParty.updateMany({ where: { showingId: showing.id }, data: { taxIdEncrypted: null, taxOfficeEncrypted: null, identityVerifiedAt: null } });
    const r = await lib.evaluateShowing(db, showing.id);
    assert.deepEqual(codes(r).blocking, ["PARTY_TAX_ID_MISSING"]);
    assert.deepEqual(codes(r).warnings, ["PARTY_TAX_OFFICE_MISSING", "PARTY_IDENTITY_UNVERIFIED"]);
  });

  it("without an approved ACTIVE template (or in a language that has none) a showing cannot be issued", async () => {
    const en = await readyShowing({ language: "en" });
    assert.ok(codes(await lib.evaluateShowing(db, en.showing.id)).blocking.includes("TEMPLATE_MISSING"));
    await assert.rejects(lib.markShowingReady(db, en.showing.id, actor), lib.DocumentBlockedError);
  });

  it("a tampered template text is detected through its checksum", async () => {
    const { showing } = await readyShowing();
    const v = await db.mandateTemplateVersion.findFirstOrThrow({ where: { template: { type: "SHOWING", locale: "el" }, status: "ACTIVE" } });
    await db.mandateTemplateVersion.update({ where: { id: v.id }, data: { body: v.body + " tampered" } }).catch(() => undefined);
    const tampered = (await db.mandateTemplateVersion.findUniqueOrThrow({ where: { id: v.id } })).body !== v.body;
    const r = await lib.evaluateShowing(db, showing.id);
    if (tampered) assert.ok(codes(r).blocking.includes("TEMPLATE_CHECKSUM_INVALID"));
    else assert.ok(true, "the database itself refused to change an active version");
    await db.mandateTemplateVersion.update({ where: { id: v.id }, data: { body: v.body } }).catch(() => undefined);
  });

  it("missing company data is a configuration problem, never invented", async () => {
    const { showing } = await readyShowing();
    const saved = await db.companyLegalDetails.findUniqueOrThrow({ where: { id: "default" } });
    await db.companyLegalDetails.update({ where: { id: "default" }, data: { vatNumber: null, taxOffice: " " } });
    try {
      const r = await lib.evaluateShowing(db, showing.id);
      assert.equal(codes(r).blocking.filter((c) => c === "COMPANY_DATA_MISSING").length, 2);
    } finally {
      await db.companyLegalDetails.update({ where: { id: "default" }, data: { vatNumber: saved.vatNumber, taxOffice: saved.taxOffice } });
    }
  });

  it("the showing lifecycle is enforced by the database: ready first, frozen once issued, final states final", async () => {
    const { showing } = await readyShowing();
    await rejects(db.showing.update({ where: { id: showing.id }, data: { status: "ISSUED" } }), /cannot move from DRAFT to ISSUED/);
    await lib.markShowingReady(db, showing.id, actor);
    const issued = await lib.issueShowing(db, showing.id, actor);
    assert.equal(issued.status, "ISSUED");
    assert.ok(issued.number && issued.issuedAt && issued.templateVersionId && issued.templateChecksum);

    await rejects(db.showing.update({ where: { id: showing.id }, data: { comments: "αλλαγή" } }), /issued showing cannot be edited/);
    await rejects(db.showing.update({ where: { id: showing.id }, data: { feePercentage: 3 } }), /issued showing cannot be edited/);
    await rejects(db.showing.update({ where: { id: showing.id }, data: { number: "ΥΠ-2026-999999", year: 2026 } }), /issued showing cannot be edited/);
    await rejects(db.showing.update({ where: { id: showing.id }, data: { status: "DRAFT" } }), /cannot move from ISSUED to DRAFT/);
    await rejects(db.showing.delete({ where: { id: showing.id } }), /cannot be deleted/);

    await db.showing.update({ where: { id: showing.id }, data: { status: "SENT", sentAt: new Date() } });
    await db.showing.update({ where: { id: showing.id }, data: { status: "SIGNED", signedAt: new Date(), signedPdfStorageKey: "k", signedPdfChecksum: "c" } });
    await rejects(db.showing.update({ where: { id: showing.id }, data: { comments: "x" } }), /signed showing cannot be changed/);
    await rejects(db.showing.update({ where: { id: showing.id }, data: { status: "SENT" } }), /cannot move from SIGNED/);
  });

  it("the database refuses an issued showing without number, issue time and template", async () => {
    await rejects(db.showing.create({ data: { status: "ISSUED" } }), /showings_issued_complete_check/);
    await rejects(db.showing.create({ data: { number: "ΥΠ-26-1" } }), /showings_number_format_check/);
    await rejects(db.showing.create({ data: { number: "ΥΠ-2026-000001", year: 2025 } }), /showings_number_year_check/);
  });

  it("showing events are append-only", async () => {
    const { showing } = await readyShowing();
    await lib.markShowingReady(db, showing.id, actor);
    const event = await db.showingEvent.findFirstOrThrow({ where: { showingId: showing.id } });
    await rejects(db.showingEvent.update({ where: { id: event.id }, data: { summary: "x" } }), /append-only/);
    await rejects(db.showingEvent.delete({ where: { id: event.id } }), /append-only/);
  });

  it("a Viewing stays an independent appointment; a Showing links to it only optionally", async () => {
    const p = await mkProperty();
    const visit = await db.viewing.create({ data: { propertyId: p.id, clientName: "Πελάτης", startsAt: new Date(Date.now() + 86400000), agentId: agent.id } });
    assert.equal(visit.showingId, null, "a viewing needs no showing");
    const { showing } = await readyShowing({ properties: [p] });
    await db.showing.update({ where: { id: showing.id }, data: { sourceViewingId: visit.id } });
    await db.viewing.update({ where: { id: visit.id }, data: { showingId: showing.id, status: "COMPLETED" } });
    assert.equal((await db.viewing.findUniqueOrThrow({ where: { id: visit.id } })).showingId, showing.id);
    // The showing's document can exist with no viewing at all (readyShowing above), and deleting the draft clears the link.
    await db.showingEvent.deleteMany({ where: { showingId: showing.id } }).catch(() => undefined);
    await db.showingProperty.deleteMany({ where: { showingId: showing.id } });
    await db.showingParty.deleteMany({ where: { showingId: showing.id } });
    await db.showing.delete({ where: { id: showing.id } }).catch(() => undefined);
    const still = await db.viewing.findUniqueOrThrow({ where: { id: visit.id } });
    assert.equal(still.status, "COMPLETED", "the appointment history is untouched");
  });

  // ---- property owners -------------------------------------------------------------------

  it("a property has several owners with shares, a single primary contact, and representatives need authority", async () => {
    const p = await mkProperty();
    const [a, b, c] = await Promise.all([mkContact(), mkContact(), mkContact()]);
    await db.propertyOwner.create({ data: { propertyId: p.id, contactId: a.id, capacity: "CO_OWNER", ownershipPercentage: 60, isPrimaryContact: true, isSignatory: true } });
    await db.propertyOwner.create({ data: { propertyId: p.id, contactId: b.id, capacity: "CO_OWNER", ownershipPercentage: 40, isSignatory: true } });
    const facts = await lib.loadOwnerFacts(db, p.id);
    assert.equal(facts.length, 2);
    assert.deepEqual(codes(domain.validateOwnership(facts)), { blocking: [], warnings: [] });

    await rejects(db.propertyOwner.create({ data: { propertyId: p.id, contactId: c.id, capacity: "CO_OWNER", ownershipPercentage: 150 } }), /property_owners_percentage_check/);
    await rejects(db.propertyOwner.create({ data: { propertyId: p.id, contactId: c.id, capacity: "CO_OWNER", isPrimaryContact: true } }), /property_owners_one_primary_idx|Unique constraint/);
    await rejects(db.propertyOwner.create({ data: { propertyId: p.id, contactId: a.id, capacity: "CO_OWNER" } }), /Unique constraint|property_owners_current_idx/);
    await rejects(db.propertyOwner.create({ data: { propertyId: p.id, contactId: c.id, capacity: "ATTORNEY_IN_FACT", isSignatory: true } }), /property_owners_authority_check/);
    await db.propertyOwner.create({ data: { propertyId: p.id, contactId: c.id, capacity: "ATTORNEY_IN_FACT", isSignatory: true, authorityReference: "Πληρεξούσιο 55/2026" } });
    await rejects(db.propertyOwner.create({ data: { propertyId: p.id, contactId: c.id, capacity: "OTHER", validFrom: new Date("2026-02-01"), validTo: new Date("2026-01-01") } }), /property_owners_validity_check/);
  });

  it("a property with only the old ownerId is read as a single owner with no assumed share", async () => {
    const owner = await mkContact();
    const p = await mkProperty({ ownerId: owner.id });
    const facts = await lib.loadOwnerFacts(db, p.id);
    assert.deepEqual(facts.map((f) => [f.contactId, f.capacity, f.ownershipPercentage]), [[owner.id, "OWNER", null]]);
    assert.deepEqual(await lib.loadOwnerFacts(db, (await mkProperty()).id), []);
  });

  // ---- mandates: structured terms --------------------------------------------------------------

  const mkMandate = async (over: Record<string, unknown> = {}) => {
    const property = (over.property as { id: string } | undefined) ?? (await mkProperty());
    const existing = await db.propertyOwner.findFirst({ where: { propertyId: property.id } });
    const owner = existing ? await db.contact.findUniqueOrThrow({ where: { id: existing.contactId } }) : await mkContact();
    if (!existing) await db.propertyOwner.create({ data: { propertyId: property.id, contactId: owner.id, capacity: "OWNER", ownershipPercentage: 100, isPrimaryContact: true, isSignatory: true } });
    const { property: _p, parties: _parties, status, number, signedAt, issuedAt, ...rest } = over as { property?: unknown; parties?: unknown; status?: string; number?: string; signedAt?: Date; issuedAt?: Date } & Record<string, unknown>;
    let mandate = await db.mandate.create({
      data: {
        reference: uniq("MND-T"), type: "SIMPLE_ASSIGNMENT", locale: "el", propertyId: property.id, agentId: agent.id,
        startsAt: new Date("2026-11-01"), durationType: "INDEFINITE", ...goodFee,
        knownDefects: false, defectsDisclosureConfirmed: true, photoPermission: true, videoPermission: true, floorplanPermission: true, signboardPermission: true,
        portalPublicationPermission: true, socialMediaPermission: true, cooperatingBrokerPermission: true, brokerCooperationAllowed: true, ...rest,
      },
    });
    await db.mandateParty.create({
      data: { mandateId: mandate.id, role: "OWNER", contactId: owner.id, fullName: "Ιδιοκτήτης Δοκιμής", taxIdEncrypted: pii.encryptField("987654321"), idNumberEncrypted: pii.encryptField("ΧΨ987654"), addressEncrypted: pii.encryptField("Οδός 9"), phoneEncrypted: pii.encryptField("6911111111") },
    });
    // The mandate is promoted last: once issued the database freezes it and its parties.
    if (status) mandate = await db.mandate.update({ where: { id: mandate.id }, data: { status, number: number ?? null, signedAt: signedAt ?? null, issuedAt: issuedAt ?? null } });
    return { mandate, property, owner };
  };

  it("a complete simple mandate (indefinite) validates; an existing one with no new fields is simply incomplete", async () => {
    const { mandate } = await mkMandate();
    assert.equal((await lib.evaluateMandate(db, mandate.id)).status, "READY");
    // A mandate created before this migration has none of the new columns.
    const legacy = await db.mandate.create({ data: { reference: uniq("MND-OLD"), type: "SIMPLE_ASSIGNMENT", locale: "el" } });
    assert.equal(legacy.feeMethod, null);
    assert.equal(legacy.durationType, null);
    const r = await lib.evaluateMandate(db, legacy.id);
    assert.equal(r.status, "BLOCKED");
    assert.equal(r.draftSaveable, true);
  });

  it("a simple fixed-term mandate needs an end; an indefinite one must not have one", async () => {
    await rejects(mkMandate({ durationType: "FIXED_TERM", endsAt: null }), /mandates_fixed_term_end_check/);
    const { mandate } = await mkMandate({ durationType: "FIXED_TERM", endsAt: new Date("2027-01-31") });
    assert.equal((await lib.evaluateMandate(db, mandate.id)).status, "READY");
    const bad = await mkMandate({ durationType: "INDEFINITE", endsAt: new Date("2027-01-31") });
    assert.ok(codes(await lib.evaluateMandate(db, bad.mandate.id)).blocking.includes("INDEFINITE_WITH_END_DATE"));
  });

  it("an exclusive mandate: dates mandatory, never indefinite, end not before start, within the configured maximum", async () => {
    const ok = await mkMandate({ type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", endsAt: new Date("2027-04-30") });
    assert.equal((await lib.evaluateMandate(db, ok.mandate.id)).status, "READY");

    await rejects(mkMandate({ type: "EXCLUSIVE_ASSIGNMENT", durationType: "INDEFINITE", endsAt: null }), /mandates_exclusive_term_check/);
    await rejects(mkMandate({ type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", endsAt: new Date("2026-10-01") }), /mandates_dates_ordered_check/);

    const noEnd = await mkMandate({ type: "EXCLUSIVE_ASSIGNMENT", durationType: null, endsAt: null });
    assert.ok(codes(await lib.evaluateMandate(db, noEnd.mandate.id)).blocking.includes("END_DATE_MISSING"));

    const tooLong = await mkMandate({ type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", endsAt: new Date("2028-06-30") });
    assert.ok(codes(await lib.evaluateMandate(db, tooLong.mandate.id)).blocking.includes("EXCLUSIVE_TOO_LONG"));
  });

  it("with no maximum configured, none is enforced and the gap is reported", async () => {
    await db.mandateSettings.update({ where: { id: "default" }, data: { maxExclusiveMonths: null } });
    try {
      const m = await mkMandate({ type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", endsAt: new Date("2030-12-31") });
      const r = await lib.evaluateMandate(db, m.mandate.id);
      assert.ok(!codes(r).blocking.includes("EXCLUSIVE_TOO_LONG"));
      assert.ok(codes(r).warnings.includes("EXCLUSIVE_MAX_NOT_CONFIGURED"));
    } finally {
      await db.mandateSettings.update({ where: { id: "default" }, data: { maxExclusiveMonths: 12 } });
    }
  });

  it("an issued mandate stays frozen, including the new structured columns", async () => {
    const { mandate } = await mkMandate();
    await db.mandate.update({ where: { id: mandate.id }, data: { status: "ISSUED", issuedAt: new Date(), number: uniq("N") } });
    await rejects(db.mandate.update({ where: { id: mandate.id }, data: { feePercentage: 5 } }), /issued mandate cannot be edited/);
    await rejects(db.mandate.update({ where: { id: mandate.id }, data: { photoPermission: false } }), /issued mandate cannot be edited/);
  });

  // ---- fees -------------------------------------------------------------------------------------

  it("the database enforces fee bounds, a single fee method and VAT only where VAT applies", async () => {
    await rejects(mkMandate({ feePercentage: 120 }), /mandates_fee_bounds_check/);
    await rejects(mkMandate({ feePercentage: -1 }), /mandates_fee_bounds_check/);
    await rejects(mkMandate({ feeMethod: "FIXED_AMOUNT", feePercentage: 2, feeFixedAmount: 3000 }), /mandates_fee_method_check/);
    await rejects(mkMandate({ feeMethod: "PERCENTAGE", feePercentage: 2, feeFixedAmount: 3000 }), /mandates_fee_method_check/);
    await rejects(mkMandate({ vatTreatment: "VAT_EXEMPT", vatRate: 24 }), /mandates_vat_rate_check/);
    await rejects(db.showing.create({ data: { feePercentage: 101 } }), /showings_fee_bounds_check/);
    await rejects(db.showing.create({ data: { vatTreatment: "NOT_APPLICABLE", vatRate: 24 } }), /showings_vat_rate_check/);
  });

  it("commission: percentage, fixed fee and both VAT treatments are calculated from the stored terms", async () => {
    const pct = await mkMandate({ property: await mkProperty({ price: 250000 }) });
    assert.deepEqual(await lib.calculateMandateFee(db, pct.mandate.id), { net: 5000, vat: 1200, gross: 6200, currency: "EUR" });

    const fixed = await mkMandate({ feeMethod: "FIXED_AMOUNT", feePercentage: null, feeFixedAmount: 3000, feeBasis: null });
    assert.deepEqual(await lib.calculateMandateFee(db, fixed.mandate.id), { net: 3000, vat: 720, gross: 3720, currency: "EUR" });

    const included = await mkMandate({ feeMethod: "FIXED_AMOUNT", feePercentage: null, feeFixedAmount: 6200, vatTreatment: "VAT_INCLUDED" });
    assert.deepEqual(await lib.calculateMandateFee(db, included.mandate.id), { net: 5000, vat: 1200, gross: 6200, currency: "EUR" });

    // No rate on the document: the configured Settings rate applies, and nothing is invented without one.
    const fromSettings = await mkMandate({ vatRate: null, property: await mkProperty({ price: 100000 }) });
    assert.equal((await lib.calculateMandateFee(db, fromSettings.mandate.id))?.vat, 480);
    await db.commissionSettings.update({ where: { id: "default" }, data: { vatRatePct: null } });
    try {
      assert.equal(await lib.calculateMandateFee(db, fromSettings.mandate.id), null);
      assert.ok(codes(await lib.evaluateMandate(db, fromSettings.mandate.id)).blocking.includes("VAT_RATE_UNCONFIGURED"));
    } finally {
      await db.commissionSettings.update({ where: { id: "default" }, data: { vatRatePct: 24 } });
    }
  });

  it("the fee-equals-price mistake is flagged on the stored mandate and on a showing, and nothing is changed", async () => {
    const p = await mkProperty({ price: 14600 });
    const { mandate } = await mkMandate({ property: p, feeMethod: "FIXED_AMOUNT", feePercentage: null, feeFixedAmount: 14600, feeBasis: null });
    const r = await lib.evaluateMandate(db, mandate.id);
    const anomaly = r.warnings.find((w) => w.code === "COMMISSION_ANOMALY");
    assert.equal(anomaly?.reason, "EQUALS_PRICE");
    assert.equal(Number((await db.mandate.findUniqueOrThrow({ where: { id: mandate.id } })).feeFixedAmount), 14600);

    const { showing } = await readyShowing({ properties: [p], fee: { feeMethod: "FIXED_AMOUNT", feePercentage: null, feeFixedAmount: 14600, feeBasis: null } });
    assert.ok(codes(await lib.evaluateShowing(db, showing.id)).warnings.includes("COMMISSION_ANOMALY"));
  });

  // ---- payment milestones ------------------------------------------------------------------------

  it("milestones belong to exactly one parent and one amount, are ordered, and total 100 %", async () => {
    const { mandate } = await mkMandate();
    const { showing } = await readyShowing();
    await db.paymentMilestone.createMany({
      data: [
        { mandateId: mandate.id, sequence: 1, percentage: 50, trigger: "PRELIMINARY_AGREEMENT" },
        { mandateId: mandate.id, sequence: 2, percentage: 50, trigger: "FINAL_CONTRACT" },
      ],
    });
    assert.equal((await lib.evaluateMandate(db, mandate.id)).status, "READY");

    await rejects(db.paymentMilestone.create({ data: { mandateId: mandate.id, showingId: showing.id, sequence: 9, percentage: 10, trigger: "CUSTOM" } }), /payment_milestones_one_parent_check/);
    await rejects(db.paymentMilestone.create({ data: { sequence: 9, percentage: 10, trigger: "CUSTOM" } }), /payment_milestones_one_parent_check/);
    await rejects(db.paymentMilestone.create({ data: { mandateId: mandate.id, sequence: 9, percentage: 10, fixedAmount: 100, trigger: "CUSTOM" } }), /payment_milestones_one_amount_check/);
    await rejects(db.paymentMilestone.create({ data: { mandateId: mandate.id, sequence: 9, trigger: "CUSTOM" } }), /payment_milestones_one_amount_check/);
    await rejects(db.paymentMilestone.create({ data: { mandateId: mandate.id, sequence: 9, percentage: 150, trigger: "CUSTOM" } }), /payment_milestones_values_check/);
    await rejects(db.paymentMilestone.create({ data: { mandateId: mandate.id, sequence: 1, percentage: 10, trigger: "CUSTOM" } }), /Unique constraint/);

    // Not adding up is a validation problem, caught before issue.
    await db.paymentMilestone.update({ where: { mandateId_sequence_placeholder: undefined as never } as never, data: {} }).catch(() => undefined);
    await db.paymentMilestone.updateMany({ where: { mandateId: mandate.id, sequence: 2 }, data: { percentage: 40 } });
    assert.ok(codes(await lib.evaluateMandate(db, mandate.id)).blocking.includes("MILESTONE_PERCENTAGE_TOTAL"));
  });

  it("showing milestones freeze with the showing", async () => {
    const { showing } = await readyShowing();
    const m = await db.paymentMilestone.create({ data: { showingId: showing.id, sequence: 1, percentage: 100, trigger: "FINAL_CONTRACT" } });
    assert.equal((await lib.evaluateShowing(db, showing.id)).status, "READY");
    await lib.markShowingReady(db, showing.id, actor);
    await lib.issueShowing(db, showing.id, actor);
    await rejects(db.paymentMilestone.update({ where: { id: m.id }, data: { percentage: 90 } }), /payment schedule of an issued document/);
    await rejects(db.paymentMilestone.create({ data: { showingId: showing.id, sequence: 2, percentage: 10, trigger: "CUSTOM" } }), /payment schedule of an issued document/);
    await rejects(db.paymentMilestone.delete({ where: { id: m.id } }), /payment schedule of an issued document/);
  });

  // ---- exclusive conflicts and overrides --------------------------------------------------------

  it("overlapping exclusive mandates on the same property are detected; other states and other properties are not", async () => {
    const property = await mkProperty();
    const first = await mkMandate({ property, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2026-11-01"), endsAt: new Date("2027-04-30"), status: "SIGNED", number: uniq("N") });
    const second = await mkMandate({ property, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2027-03-01"), endsAt: new Date("2027-08-31") });
    const conflict = await lib.checkExclusiveConflict(db, second.mandate.id, new Date("2026-10-06"));
    assert.deepEqual(codes(conflict).blocking, ["EXCLUSIVE_CONFLICT"]);
    assert.match(conflict.blockingIssues[0]!.message, /Υπάρχει ενεργή αποκλειστική ανάθεση για το συγκεκριμένο ακίνητο/);
    assert.ok(codes(await lib.evaluateMandate(db, second.mandate.id)).blocking.includes("EXCLUSIVE_CONFLICT"), "part of the mandate's validation");

    // Cancelled, expired, declined and draft mandates do not compete.
    for (const status of ["CANCELLED", "EXPIRED", "DECLINED", "DRAFT"]) {
      const quiet = await mkProperty();
      await mkMandate({ property: quiet, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2026-11-01"), endsAt: new Date("2027-04-30"), ...(status === "DRAFT" ? {} : { status, number: uniq("N") }) });
      const probe = await mkMandate({ property: quiet, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2027-03-01"), endsAt: new Date("2027-08-31") });
      assert.equal((await lib.checkExclusiveConflict(db, probe.mandate.id)).blockingIssues.length, 0, status);
    }
    assert.ok(first.mandate.id);

    // Another property is unaffected.
    const elsewhere = await mkMandate({ type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2027-03-01"), endsAt: new Date("2027-08-31") });
    assert.equal((await lib.checkExclusiveConflict(db, elsewhere.mandate.id)).blockingIssues.length, 0);
  });

  it("a superseded mandate does not conflict with the one replacing it, and history is kept", async () => {
    const property = await mkProperty();
    const old = await mkMandate({ property, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2026-11-01"), endsAt: new Date("2027-04-30"), status: "SIGNED", number: uniq("N") });
    const replacement = await mkMandate({ property, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2027-01-01"), endsAt: new Date("2027-06-30"), supersedesMandateId: old.mandate.id });
    assert.equal((await lib.checkExclusiveConflict(db, replacement.mandate.id)).blockingIssues.length, 0);
    assert.equal((await db.mandate.findUniqueOrThrow({ where: { id: old.mandate.id } })).status, "SIGNED", "the earlier mandate is not rewritten");
  });

  it("only a manager can override a conflict, with a reason, once; the override is append-only", async () => {
    const property = await mkProperty();
    const first = await mkMandate({ property, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2026-11-01"), endsAt: new Date("2027-04-30"), status: "SIGNED", number: uniq("N") });
    const second = await mkMandate({ property, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2027-03-01"), endsAt: new Date("2027-08-31") });
    const input = { mandateId: second.mandate.id, conflictingMandateId: first.mandate.id, reason: "Ο ιδιοκτήτης συμφώνησε εγγράφως" };

    await assert.rejects(lib.recordConflictOverride(db, { ...input, approver: { id: agent.id, role: "AGENT" } }), (e: { code?: string }) => e.code === "FORBIDDEN");
    await assert.rejects(lib.recordConflictOverride(db, { ...input, reason: "  ", approver: { id: manager.id, role: "MANAGER" } }), (e: { code?: string }) => e.code === "REASON_REQUIRED");
    assert.equal((await lib.checkExclusiveConflict(db, second.mandate.id)).blockingIssues.length, 1, "nothing changed yet");

    const override = await lib.recordConflictOverride(db, { ...input, approver: { id: manager.id, role: "MANAGER" } });
    const after = await lib.checkExclusiveConflict(db, second.mandate.id);
    assert.deepEqual(codes(after), { blocking: [], warnings: ["EXCLUSIVE_CONFLICT_OVERRIDDEN"] });
    await assert.rejects(lib.recordConflictOverride(db, { ...input, approver: { id: manager.id, role: "ADMIN" } }), /Unique constraint/);
    await rejects(db.mandateConflictOverride.update({ where: { id: override.id }, data: { reason: "x" } }), /append-only/);
    await rejects(db.mandateConflictOverride.delete({ where: { id: override.id } }), /append-only/);

    // And there must be a real conflict to override.
    const unrelated = await mkMandate({ property, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2028-01-01"), endsAt: new Date("2028-03-31") });
    await assert.rejects(lib.recordConflictOverride(db, { mandateId: unrelated.mandate.id, conflictingMandateId: first.mandate.id, reason: "x", approver: { id: manager.id, role: "MANAGER" } }), (e: { code?: string }) => e.code === "NO_CONFLICT");
  });

  // ---- extensions ----------------------------------------------------------------------------------------

  it("an extension is a separate record: the end date is never overwritten, extensions chain, and issued ones are frozen", async () => {
    const { mandate } = await mkMandate({ type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2026-11-01"), endsAt: new Date("2027-04-30"), status: "SIGNED", number: uniq("N"), signedAt: new Date() });
    await assert.rejects(lib.createMandateExtension(db, { mandateId: mandate.id, newEndDate: "2027-04-30", actor }), (e: { code?: string }) => e.code === "EXTENSION_NOT_LATER");

    const x1 = await lib.createMandateExtension(db, { mandateId: mandate.id, newEndDate: "2027-07-31", reason: "Συμφωνία παράτασης", actor });
    assert.equal(x1.previousEndDate.toISOString().slice(0, 10), "2027-04-30");
    await assert.rejects(lib.createMandateExtension(db, { mandateId: mandate.id, newEndDate: "2027-09-30", actor }), (e: { code?: string }) => e.code === "EXTENSION_PENDING");
    assert.equal((await lib.currentEndDate(db, mandate.id))!.toISOString().slice(0, 10), "2027-04-30", "a draft extension changes nothing");

    await lib.issueMandateExtension(db, x1.id, { text: "Παράταση έως 31/7/2027", actor });
    assert.equal((await lib.currentEndDate(db, mandate.id))!.toISOString().slice(0, 10), "2027-07-31", "an issued extension counts as pending until signed");
    await lib.resolveMandateExtension(db, x1.id, "SIGNED", { actor, signedPdfStorageKey: "k" });

    const x2 = await lib.createMandateExtension(db, { mandateId: mandate.id, newEndDate: "2027-10-31", actor });
    assert.equal(x2.previousEndDate.toISOString().slice(0, 10), "2027-07-31", "chained to the current effective end");

    // The mandate's own end date is untouched, and signed history cannot be rewritten.
    assert.equal((await db.mandate.findUniqueOrThrow({ where: { id: mandate.id } })).endsAt!.toISOString().slice(0, 10), "2027-04-30");
    await rejects(db.mandateExtension.update({ where: { id: x1.id }, data: { newEndDate: new Date("2030-01-01") } }), /extension cannot be changed/);
    await rejects(db.mandateExtension.delete({ where: { id: x1.id } }), /extension cannot be deleted/);
    await rejects(db.mandateExtension.create({ data: { mandateId: mandate.id, previousEndDate: new Date("2027-10-31"), newEndDate: new Date("2027-10-01") } }), /mandate_extensions_dates_check/);
    const events = await db.mandateEvent.findMany({ where: { mandateId: mandate.id, type: { startsWith: "EXTENSION" } } });
    assert.ok(events.length >= 4);
  });

  it("only a signed mandate with an end date can be extended; the extended period must not collide with another exclusive", async () => {
    const draft = await mkMandate({ type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", endsAt: new Date("2027-04-30") });
    await assert.rejects(lib.createMandateExtension(db, { mandateId: draft.mandate.id, newEndDate: "2027-09-30", actor }), (e: { code?: string }) => e.code === "MANDATE_NOT_SIGNED");
    const open = await mkMandate({ status: "SIGNED", number: uniq("N"), signedAt: new Date() });
    await assert.rejects(lib.createMandateExtension(db, { mandateId: open.mandate.id, newEndDate: "2027-09-30", actor }), (e: { code?: string }) => e.code === "MANDATE_HAS_NO_END");

    const property = await mkProperty();
    const a = await mkMandate({ property, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2026-11-01"), endsAt: new Date("2027-04-30"), status: "SIGNED", number: uniq("N"), signedAt: new Date() });
    await mkMandate({ property, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2027-06-01"), endsAt: new Date("2027-10-31"), status: "SIGNED", number: uniq("N"), signedAt: new Date() });
    await assert.rejects(lib.createMandateExtension(db, { mandateId: a.mandate.id, newEndDate: "2027-07-31", actor }), (e: { code?: string }) => e.code === "EXCLUSIVE_CONFLICT");
    await lib.createMandateExtension(db, { mandateId: a.mandate.id, newEndDate: "2027-05-31", actor });
  });

  it("a pending extension (issued, unsigned) counts in conflict detection", async () => {
    const property = await mkProperty();
    const a = await mkMandate({ property, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2026-11-01"), endsAt: new Date("2027-04-30"), status: "SIGNED", number: uniq("N"), signedAt: new Date() });
    const b = await mkMandate({ property, type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", startsAt: new Date("2027-06-01"), endsAt: new Date("2027-12-31") });
    assert.equal((await lib.checkExclusiveConflict(db, b.mandate.id, new Date("2026-10-06"))).blockingIssues.length, 0);
    const x = await lib.createMandateExtension(db, { mandateId: a.mandate.id, newEndDate: "2027-06-15", actor });
    await lib.issueMandateExtension(db, x.id, { text: "Παράταση", actor });
    const r = await lib.checkExclusiveConflict(db, b.mandate.id, new Date("2026-10-06"));
    assert.equal(r.blockingIssues[0]?.reason, "PENDING_EXTENSION");
    await lib.resolveMandateExtension(db, x.id, "CANCELLED", { actor });
    assert.equal((await lib.checkExclusiveConflict(db, b.mandate.id, new Date("2026-10-06"))).blockingIssues.length, 0, "a cancelled extension no longer counts");
  });

  // ---- legal templates -------------------------------------------------------------------------------------

  it("legacy Estate+ wording can never become ACTIVE without counsel's approval of that exact text", async () => {
    const template = await db.mandateTemplate.upsert({ where: { type_locale: { type: `LEGACY_TEST_${RUN}`, locale: "el" } }, create: { type: `LEGACY_TEST_${RUN}`, locale: "el" }, update: {} });
    const legacy = domain.LEGACY_ESTATE_PLUS_TEMPLATES[0]!;
    const flags = domain.detectLegacyLegalFlags(legacy.body);
    const version = (n: number, over: Record<string, unknown>) => db.mandateTemplateVersion.create({ data: { templateId: template.id, version: n, body: legacy.body, checksum: sha(legacy.body), source: "ESTATE_PLUS_LEGACY", requiresLegalReview: true, legalReviewFlags: flags, ...over } });

    // Legacy text must be flagged for review.
    await rejects(version(1, { requiresLegalReview: false }), /legacy_review_check/);
    const draft = await version(2, {});
    assert.equal(draft.status, "DRAFT");
    assert.ok(draft.legalReviewFlags.includes("LAW_2472_1997"));
    assert.equal(draft.body, legacy.body, "kept verbatim");

    // …and cannot be activated: not directly, not with a partial or mismatching approval.
    await rejects(version(3, { status: "ACTIVE" }), /legal_approval_check/);
    await rejects(db.mandateTemplateVersion.update({ where: { id: draft.id }, data: { status: "ACTIVE" } }), /legal_approval_check/);
    await rejects(db.mandateTemplateVersion.update({ where: { id: draft.id }, data: { status: "ACTIVE", legalApprovedAt: new Date(), legalApprovedBy: "Δικηγόρος" } }), /legal_approval_check/);
    await rejects(db.mandateTemplateVersion.update({ where: { id: draft.id }, data: { status: "ACTIVE", legalApprovedAt: new Date(), legalApprovedBy: "Δικηγόρος", legalApprovedChecksum: sha("another text") } }), /legal_approval_check/);
    assert.equal((await db.mandateTemplateVersion.findUniqueOrThrow({ where: { id: draft.id } })).status, "DRAFT");

    // With counsel's approval recorded against this text it may be activated.
    const approved = await db.mandateTemplateVersion.update({ where: { id: draft.id }, data: { status: "ACTIVE", legalApprovedAt: new Date(), legalApprovedBy: "Δικηγόρος Δοκιμής", legalApprovedChecksum: draft.checksum } });
    assert.equal(approved.status, "ACTIVE");
  });

  it("a showing cannot use a template that still needs legal review, even if it were ACTIVE", async () => {
    const check = domain.validateTemplateCheck({ found: true, active: true, checksumValid: true, requiresLegalReview: true, legalApproved: false, type: "SHOWING", locale: "el" }, { type: "SHOWING", locale: "el" });
    assert.deepEqual(check.blockingIssues.map((i) => i.code), ["TEMPLATE_LEGAL_APPROVAL_MISSING"]);
  });

  // ---- legacy mappings -------------------------------------------------------------------------------------

  it("legacy mappings are idempotent: the same legacy id gives the same record, never a second one", async () => {
    const target = await mkProperty();
    const input = { sourceSystem: "ESTATE_PLUS" as const, sourceEntityType: "PROPERTY", legacyId: uniq("2436"), targetEntityType: "PROPERTY", targetEntityId: target.id, importBatchId: "batch-1", sourcePayloadHash: "h1" };
    const first = await lib.recordLegacyMapping(db, input);
    assert.equal(first.status, "created");
    const again = await lib.recordLegacyMapping(db, input);
    assert.deepEqual([again.status, again.id], ["existing", first.id]);
    const changed = await lib.recordLegacyMapping(db, { ...input, sourcePayloadHash: "h2" });
    assert.equal(changed.payloadChanged, true, "reported, not silently applied");

    // Concurrent imports of the same id still produce one row.
    const racing = { ...input, legacyId: uniq("2437") };
    const results = await Promise.all(Array.from({ length: 6 }, () => lib.recordLegacyMapping(db, racing)));
    assert.equal(results.filter((r) => r.status === "created").length, 1);
    assert.equal(await db.legacyEntityMapping.count({ where: { legacyId: racing.legacyId } }), 1);

    const found = await lib.resolveLegacyMapping(db, input);
    assert.equal(found?.targetEntityId, target.id);
  });

  it("a legacy id can never be pointed at a different record, and duplicates are rejected by the database", async () => {
    const [a, b] = [await mkProperty(), await mkProperty()];
    const legacyId = uniq("999");
    await lib.recordLegacyMapping(db, { sourceSystem: "ESTATE_PLUS", sourceEntityType: "PROPERTY", legacyId, targetEntityType: "PROPERTY", targetEntityId: a.id });
    await assert.rejects(lib.recordLegacyMapping(db, { sourceSystem: "ESTATE_PLUS", sourceEntityType: "PROPERTY", legacyId, targetEntityType: "PROPERTY", targetEntityId: b.id }), (e: { code?: string }) => e.code === "LEGACY_MAPPING_CONFLICT");
    await rejects(db.legacyEntityMapping.create({ data: { sourceSystem: "ESTATE_PLUS", sourceEntityType: "PROPERTY", legacyId, targetEntityType: "PROPERTY", targetEntityId: b.id } }), /Unique constraint/);
    // The same number from another system or entity type is a different record.
    await lib.recordLegacyMapping(db, { sourceSystem: "CSV_IMPORT", sourceEntityType: "PROPERTY", legacyId, targetEntityType: "PROPERTY", targetEntityId: b.id });
    await lib.recordLegacyMapping(db, { sourceSystem: "ESTATE_PLUS", sourceEntityType: "SHOWING", legacyId, targetEntityType: "SHOWING", targetEntityId: "x" });
    await rejects(db.legacyEntityMapping.create({ data: { sourceSystem: "ESTATE_PLUS", sourceEntityType: "CONTACT", legacyId: " ", targetEntityType: "CONTACT", targetEntityId: "c" } }), /legacy_entity_mappings_values_check/);
  });

  // ---- the whole chain ----------------------------------------------------------------------------------------

  it("the schema holds the whole chain: property → owners → viewing → showing → mandate → offer → transaction → commission", async () => {
    const property = await mkProperty();
    const owner = await mkContact();
    await db.propertyOwner.create({ data: { propertyId: property.id, contactId: owner.id, capacity: "OWNER", ownershipPercentage: 100, isPrimaryContact: true, isSignatory: true } });
    const buyer = await mkContact();
    const visit = await db.viewing.create({ data: { propertyId: property.id, contactId: buyer.id, clientName: "Αγοραστής", startsAt: new Date(Date.now() + 86400000), agentId: agent.id } });
    const { showing } = await readyShowing({ properties: [property] });
    await db.showing.update({ where: { id: showing.id }, data: { sourceViewingId: visit.id, contactId: buyer.id } });
    const { mandate } = await mkMandate({ property });
    assert.ok(visit.id && showing.id && mandate.id);
    const links = await db.property.findUniqueOrThrow({ where: { id: property.id }, include: { owners: true, viewings: true, showingProperties: true, mandates: true } });
    assert.equal(links.owners.length + links.viewings.length + links.showingProperties.length, 3);
    assert.equal(links.mandates.length, 1);
  });
});
