/**
 * Phase B: the document pipeline on a real Postgres with an in-memory object
 * store. Runs only when TEST_DATABASE_URL points at a disposable database with
 * all migrations applied. The wording used is placeholder text for the tests.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { PrismaClient } from "@home88/database";

import { memoryDocumentStore, setDocumentStore } from "../../document-store";
import { setSignatureProvider } from "../../../providers/signature";
import * as support from "./test-support";

const url = process.env.TEST_DATABASE_URL;
const SKIP = url ? false : "TEST_DATABASE_URL not set";

describe("document pipeline (real Postgres)", { skip: SKIP }, () => {
  let db: PrismaClient;
  let lib: typeof import("../index");
  let issue: typeof import("./issue");
  let signing: typeof import("./signing");
  let pii: typeof import("../../pii");
  let store: ReturnType<typeof memoryDocumentStore>;
  const run = randomBytes(4).toString("hex");
  const RUN = run.toUpperCase();
  let seq = 0;
  const uniq = (p: string) => `${p}-${RUN}-${++seq}`;
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const manager = { id: "mgr-1", name: "Μάνος Προϊστάμενος", role: "MANAGER" };
  let agent: { id: string };

  before(async () => {
    process.env.DATABASE_URL = url!;
    process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
    process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    db = (await import("../../prisma")).db();
    lib = await import("../index");
    issue = await import("./issue");
    signing = await import("./signing");
    pii = await import("../../pii");
    store = memoryDocumentStore();
    setDocumentStore(store);

    agent = await db.user.create({ data: { email: `agent-${run}@test.invalid`, firstName: "Ag", lastName: "Ent", role: "AGENT", passwordHash: "x" } });
    const legal = { legalNameEl: "HOME88 Μεσιτική", legalNameEn: "HOME88 Real Estate", vatNumber: "123456783", taxOffice: "Δοκιμαστική ΔΟΥ", registeredAddressEl: "Οδός 1, Αθήνα", registeredAddressEn: "1 Street, Athens", phone: "2100000000", legalEmail: "info@home88.test", gemiNumber: "1234567" };
    await db.companyLegalDetails.upsert({ where: { id: "default" }, create: { id: "default", ...legal }, update: legal });
    await db.commissionSettings.upsert({ where: { id: "default" }, create: { id: "default", vatRatePct: 24 }, update: { vatRatePct: 24 } });
    await db.mandateSettings.upsert({ where: { id: "default" }, create: { id: "default", maxExclusiveMonths: 12 }, update: { maxExclusiveMonths: 12 } });
    const { settings } = await import("../../../settings");
    await settings().update({ id: "super", role: "SUPER_ADMIN", name: "Super" }, "mandates", { values: { numberingPrefix: `P${RUN.slice(0, 4)}`, numberingDigits: 5, retentionYears: 10, signatureProvider: "fake", signatureLevel: "ADVANCED", signingExpiryDays: 14 } }, { ip: null });
    await support.installAllTemplates(db);
    installFakeProvider();
  });

  after(async () => {
    setDocumentStore(null);
    setSignatureProvider(null);
    await db.$disconnect();
  });

  let sentPdf: Buffer | null = null;
  let sentChecksum: string | null = null;
  let sentLevel: string | null = null;
  const installFakeProvider = () =>
    setSignatureProvider({
      name: "fake",
      async createSigningRequest(req: { pdf: Buffer; level: string; documentChecksum?: string }) { sentPdf = req.pdf; sentChecksum = req.documentChecksum ?? null; sentLevel = req.level; return { envelopeId: `env-${randomBytes(4).toString("hex")}`, signingUrls: [{ signer: 0, url: "https://sign.example/x" }] }; },
      async getEnvelopeStatus() { return "SENT"; },
      async downloadSigned() { return Buffer.from("%PDF-1.7 signed by provider"); },
      getStatus: () => ({ state: "configured", provider: "fake" }),
      async handleWebhook() { return { handled: false }; },
    } as never);

  // ---- fixtures ---------------------------------------------------------------

  const goodFee = { feePayer: "OWNER", feeMethod: "PERCENTAGE", feeBasis: "ASKING_PRICE", feePercentage: 2, feeCurrency: "EUR", vatTreatment: "PLUS_VAT", vatRate: 24 } as const;
  const mkContact = (over: Record<string, unknown> = {}) => db.contact.create({ data: { reference: uniq("C"), firstName: "Μαρία", lastName: "Παπαδοπούλου", ...over } });
  const mkProperty = (over: Record<string, unknown> = {}) => {
    const reference = uniq("H88-T");
    return db.property.create({
      data: { reference, slug: reference.toLowerCase(), listingType: "SALE", propertyType: "APARTMENT", status: "ACTIVE", titleEl: "Διαμέρισμα", descriptionEl: "Φωτεινό διαμέρισμα", address: "Οδός Δοκιμής 5", city: "Αθήνα", areaName: "Γλυφάδα", postalCode: "16674", price: 250000, area: 90, floor: 2, ...over },
    });
  };

  async function readyShowing(over: { properties?: Array<{ id: string }>; fee?: Record<string, unknown>; language?: string; parties?: number } = {}) {
    const properties = over.properties ?? [await mkProperty()];
    const client = await mkContact();
    const showing = await db.showing.create({ data: { language: over.language ?? "el", contactId: client.id, responsibleUserId: agent.id, ...goodFee, ...(over.fee ?? {}) } });
    for (const p of properties) await lib.addPropertyToShowing(db, showing.id, p.id);
    for (let i = 0; i < (over.parties ?? 1); i++) {
      await db.showingParty.create({
        data: {
          showingId: showing.id, role: i === 0 ? "BUYER" : "JOINT_BUYER", fullName: i === 0 ? "Γιώργος Κωνσταντίνου" : "Ελένη Κωνσταντίνου", sortOrder: i, contactId: i === 0 ? client.id : null,
          taxIdEncrypted: pii.encryptField(`12345678${i}`), taxOfficeEncrypted: pii.encryptField("ΔΟΥ Α΄"), idNumberEncrypted: pii.encryptField("ΑΒ123456"),
          addressEncrypted: pii.encryptField("Οδός Πελάτη 1"), phoneEncrypted: pii.encryptField("6900000000"), emailEncrypted: pii.encryptField("g@test.invalid"), identityVerifiedAt: new Date(),
        },
      });
    }
    return { showing, properties, client };
  }

  const mkMandate = async (over: Record<string, unknown> = {}) => {
    const property = (over.property as { id: string } | undefined) ?? (await mkProperty());
    const existing = await db.propertyOwner.findFirst({ where: { propertyId: property.id } });
    const owner = existing ? await db.contact.findUniqueOrThrow({ where: { id: existing.contactId } }) : await mkContact();
    if (!existing) await db.propertyOwner.create({ data: { propertyId: property.id, contactId: owner.id, capacity: "OWNER", ownershipPercentage: 100, isPrimaryContact: true, isSignatory: true } });
    const { property: _p, ...rest } = over as { property?: unknown } & Record<string, unknown>;
    const mandate = await db.mandate.create({
      data: {
        reference: uniq("MND-T"), type: "SIMPLE_ASSIGNMENT", locale: "el", propertyId: property.id, agentId: agent.id, startsAt: new Date("2026-11-01"), durationType: "INDEFINITE", ...goodFee,
        knownDefects: false, defectsDisclosureConfirmed: true, photoPermission: true, videoPermission: true, floorplanPermission: true, signboardPermission: true,
        portalPublicationPermission: true, socialMediaPermission: true, cooperatingBrokerPermission: true, brokerCooperationAllowed: true, ...rest,
      },
    });
    await db.mandateParty.create({
      data: { mandateId: mandate.id, role: "OWNER", contactId: owner.id, fullName: "Ιδιοκτήτης Δοκιμής", taxIdEncrypted: pii.encryptField("987654321"), idNumberEncrypted: pii.encryptField("ΧΨ987654"), addressEncrypted: pii.encryptField("Οδός 9"), phoneEncrypted: pii.encryptField("6911111111") },
    });
    return { mandate, property, owner };
  };
  const exclusive = (over: Record<string, unknown> = {}) => mkMandate({ type: "EXCLUSIVE_ASSIGNMENT", durationType: "FIXED_TERM", endsAt: new Date("2027-04-30"), ...over });

  const issueShowing = (id: string, extra: Record<string, unknown> = {}) => issue.issueDocument(db, "SHOWING", id, { actor: manager, ...extra });
  const issueMandate = (id: string, extra: Record<string, unknown> = {}) => issue.issueDocument(db, "MANDATE", id, { actor: manager, ...extra });
  const textOf = (encrypted: string | null) => pii.decryptField(encrypted!) as string;
  const pdfText = (bytes: Buffer) => {
    const file = join(mkdtempSync(join(tmpdir(), "pdf-")), "d.pdf");
    writeFileSync(file, bytes);
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  };
  const mandatePdf = async (id: string) => (await issue.loadIssuedPdf(db, "MANDATE", id)).bytes;
  const auditTypes = async (entityId: string) => (await db.documentAuditEvent.findMany({ where: { entityId }, orderBy: { occurredAt: "asc" } })).map((a) => a.type);
  const blockedCodes = async (p: Promise<unknown>) => {
    try { await p; } catch (e) { return ((e as { result?: { blockingIssues: Array<{ code: string }> } }).result?.blockingIssues ?? []).map((i) => i.code); }
    return null;
  };

  // ---- the six variants ---------------------------------------------------------

  for (const language of ["el", "en"] as const) {
    it(`SHOWING_${language.toUpperCase()}: issues, prints the client and property, and stores a verified private PDF`, async () => {
      const { showing, properties } = await readyShowing({ language });
      const out = await issueShowing(showing.id);
      assert.equal(out.storageState, "CONFIRMED");
      const row = await db.showing.findUniqueOrThrow({ where: { id: showing.id } });
      assert.equal(row.status, "ISSUED");
      assert.equal(row.templateChecksum, (await db.mandateTemplateVersion.findFirstOrThrow({ where: { id: row.templateVersionId! } })).checksum);
      const bytes = store.objects.get(row.pdfStorageKey!)!.body;
      assert.equal(sha(bytes), row.pdfChecksum, "PDF: the checksum is persisted and matches the stored bytes");
      assert.equal(sha(textOf(row.renderedTextEncrypted)), row.renderedTextChecksum, "TEXT checksum");
      assert.ok(row.pdfStorageKey!.startsWith(`private/documents/showings/${showing.id}/issued/`), row.pdfStorageKey!);
      const text = pdfText(bytes);
      const ref = (await db.property.findUniqueOrThrow({ where: { id: properties[0]!.id } })).reference;
      assert.ok(text.includes(ref) && text.includes(row.number!), text.slice(0, 300));
      assert.match(text, language === "el" ? /Σελίδα 1 από/ : /Page 1 of/);
    });

    for (const type of ["SIMPLE_ASSIGNMENT", "EXCLUSIVE_ASSIGNMENT"] as const) {
      it(`${type}_${language.toUpperCase()}: issues with the right type, term and signature block`, async () => {
        const { mandate } = type === "SIMPLE_ASSIGNMENT" ? await mkMandate({ locale: language }) : await exclusive({ locale: language });
        const out = await issueMandate(mandate.id);
        assert.equal(out.storageState, "CONFIRMED");
        const row = await db.mandate.findUniqueOrThrow({ where: { id: mandate.id }, include: { pdfDocument: true } });
        assert.equal(row.status, "ISSUED");
        assert.match(row.number!, new RegExp(`^P${RUN.slice(0, 4)}-\\d{5}$`));
        assert.equal(sha(store.objects.get(row.pdfDocument!.storageKey)!.body), row.pdfChecksum);
        assert.ok(row.pdfDocument!.storageKey.startsWith(`private/documents/mandates/${mandate.id}/issued/`));
        const text = pdfText(await mandatePdf(mandate.id));
        if (type === "SIMPLE_ASSIGNMENT") {
          if (language === "el") { assert.match(text, /Απλή ανάθεση/); assert.match(text, /Αορίστου χρόνου/); }
          assert.doesNotMatch(text, /αποκλειστικ|exclusive/i, "no exclusive obligations in a simple assignment");
        } else {
          if (language === "el") { assert.match(text, /Αποκλειστική ανάθεση/); assert.match(text, /01\/11\/2026/); assert.match(text, /30\/04\/2027/); }
          assert.doesNotMatch(text, /αορίστου|indefinite|Απλή ανάθεση|simple assignment/i, "no simple or open-ended alternative in an exclusive assignment");
        }
        assert.doesNotMatch(text, /αορίστου\s*\/\s*ορισμένου|Απλή\s*\/\s*Αποκλειστική/i);
      });
    }
  }

  it("a simple fixed-term mandate prints its dates; an exclusive one prints the calculated duration", async () => {
    const simple = await mkMandate({ durationType: "FIXED_TERM", endsAt: new Date("2027-01-31") });
    await issueMandate(simple.mandate.id);
    const t1 = pdfText(await mandatePdf(simple.mandate.id));
    assert.match(t1, /Ορισμένου χρόνου/); assert.match(t1, /31\/01\/2027/);
    const ex = await exclusive();
    await issueMandate(ex.mandate.id);
    assert.match(pdfText(await mandatePdf(ex.mandate.id)), /6 μήν/);
  });

  // ---- templates --------------------------------------------------------------------

  describe("template safety", () => {
    const retire = (type: string, locale: string) => db.mandateTemplateVersion.updateMany({ where: { template: { type, locale }, status: "ACTIVE" }, data: { status: "RETIRED" } });
    const restore = (type: string, locale: string) => support.installApprovedTemplate(db, type, locale);

    it("no active template → refused, draft stays a draft with no number and no PDF", async () => {
      await retire("SIMPLE_ASSIGNMENT", "el");
      try {
        const { mandate } = await mkMandate();
        assert.ok((await blockedCodes(issueMandate(mandate.id)))!.includes("TEMPLATE_NOT_ACTIVE"));
        const row = await db.mandate.findUniqueOrThrow({ where: { id: mandate.id } });
        assert.deepEqual([row.status, row.number, row.pdfChecksum, row.pdfDocumentId, row.storageState], ["DRAFT", null, null, null, "NOT_STORED"]);
        assert.ok(![...store.objects.keys()].some((k) => k.includes(mandate.id)), "nothing was written under the document's keys");
        assert.ok((await auditTypes(mandate.id)).includes("DOCUMENT_VALIDATION_BLOCKED"));
      } finally { await restore("SIMPLE_ASSIGNMENT", "el"); }
    });

    for (const [label, over] of [
      ["a legacy (Estate+) template", { source: "ESTATE_PLUS_LEGACY" }],
      ["an unapproved template", { legalApprovedAt: null }],
      ["a template approved for a different text", { legalApprovedChecksum: "0".repeat(64) }],
      ["a template whose checksum does not match its body", { checksum: "1".repeat(64) }],
    ] as const) {
      it(`${label} cannot be issued with: refused by the database or by the pipeline, never used`, async () => {
        try {
          let installed = true;
          try { await support.installApprovedTemplate(db, "SIMPLE_ASSIGNMENT", "el", over as Record<string, unknown>); } catch { installed = false; }
          if (installed) {
            const { mandate } = await mkMandate();
            await assert.rejects(issueMandate(mandate.id));
            const row = await db.mandate.findUniqueOrThrow({ where: { id: mandate.id } });
            assert.deepEqual([row.status, row.number, row.pdfChecksum], ["DRAFT", null, null]);
          }
        } finally { await restore("SIMPLE_ASSIGNMENT", "el"); }
      });
    }

    it("the templateRejection rules refuse each case directly", async () => {
      const { templateRejection } = await import("./templates");
      const body = support.approvedBody("SIMPLE_ASSIGNMENT", "el");
      const ok = { status: "ACTIVE", body, checksum: support.sha256(body), source: "HOME88", requiresLegalReview: false, legalApprovedAt: new Date(), legalApprovedBy: "c", legalApprovedChecksum: support.sha256(body) };
      assert.equal(templateRejection(ok, "SIMPLE_ASSIGNMENT"), null);
      assert.equal(templateRejection({ ...ok, status: "RETIRED" }, "SIMPLE_ASSIGNMENT")!.code, "TEMPLATE_NOT_ACTIVE");
      assert.equal(templateRejection({ ...ok, source: "ESTATE_PLUS_LEGACY" }, "SIMPLE_ASSIGNMENT")!.code, "TEMPLATE_LEGACY");
      assert.equal(templateRejection({ ...ok, legalApprovedAt: null }, "SIMPLE_ASSIGNMENT")!.code, "TEMPLATE_NOT_APPROVED");
      assert.equal(templateRejection({ ...ok, legalApprovedBy: null }, "SIMPLE_ASSIGNMENT")!.code, "TEMPLATE_NOT_APPROVED");
      assert.equal(templateRejection({ ...ok, legalApprovedChecksum: "z" }, "SIMPLE_ASSIGNMENT")!.code, "TEMPLATE_APPROVAL_MISMATCH");
      assert.equal(templateRejection({ ...ok, checksum: "z" }, "SIMPLE_ASSIGNMENT")!.code, "TEMPLATE_CHECKSUM_MISMATCH");
      const mixed = "Αποκλειστική ανάθεση {{document.number}}";
      assert.equal(templateRejection({ ...ok, body: mixed, checksum: support.sha256(mixed), legalApprovedChecksum: support.sha256(mixed) }, "SIMPLE_ASSIGNMENT")!.code, "TEMPLATE_CONTENT_INVALID");
    });

    it("a template with an unknown merge field cannot be issued with, and nothing is half-written", async () => {
      const body = "{{document.number}} {{client.nickname}}";
      await support.installApprovedTemplate(db, "SHOWING", "el", { body });
      try {
        const { showing } = await readyShowing();
        await assert.rejects(issueShowing(showing.id), (e: { code?: string }) => e.code === "TEMPLATE_FIELDS_INVALID");
        const row = await db.showing.findUniqueOrThrow({ where: { id: showing.id } });
        assert.equal(row.number, null); assert.equal(row.pdfStorageKey, null);
      } finally { await restore("SHOWING", "el"); }
    });

    it("a language with no approved version has no fallback to another language", async () => {
      await retire("EXCLUSIVE_ASSIGNMENT", "en");
      try {
        const { mandate } = await exclusive({ locale: "en" });
        assert.ok((await blockedCodes(issueMandate(mandate.id)))!.some((c) => c.startsWith("TEMPLATE_")));
      } finally { await restore("EXCLUSIVE_ASSIGNMENT", "en"); }
    });
  });

  // ---- validation & anomalies --------------------------------------------------------

  it("required fields block issuing, and the reasons are returned", async () => {
    const { mandate } = await mkMandate({ feeMethod: null, feePercentage: null });
    const codes = await blockedCodes(issueMandate(mandate.id));
    assert.ok(codes && codes.length > 0, "blocked");
    assert.equal((await db.mandate.findUniqueOrThrow({ where: { id: mandate.id } })).number, null);
  });

  it("a fee anomaly blocks issuing until a manager acknowledges it with a reason, which is audited", async () => {
    const { mandate } = await mkMandate({ feePercentage: 40 });
    const first = await blockedCodes(issueMandate(mandate.id));
    assert.ok(first!.includes("COMMISSION_ANOMALY"), JSON.stringify(first));
    const out = await issueMandate(mandate.id, { acknowledgeFeeAnomaly: "Ειδική συμφωνία με τον πελάτη" });
    assert.ok(out.number);
    const types = await auditTypes(mandate.id);
    assert.ok(types.includes("COMMISSION_ANOMALY_ACKNOWLEDGED"));
    const ack = await db.documentAuditEvent.findFirstOrThrow({ where: { entityId: mandate.id, type: "COMMISSION_ANOMALY_ACKNOWLEDGED" } });
    assert.equal(ack.actorUserId, manager.id); assert.equal(ack.actorRole, "MANAGER");
    assert.ok(ack.reason);
  });

  it("a rejected anomaly acknowledgement does not leave a draft with a forged override", async () => {
    const { mandate } = await mkMandate({ feePercentage: 40 });
    await db.mandateTemplateVersion.updateMany({ where: { template: { type: "SIMPLE_ASSIGNMENT", locale: "el" }, status: "ACTIVE" }, data: { status: "RETIRED" } });
    try {
      await blockedCodes(issueMandate(mandate.id, { acknowledgeFeeAnomaly: "ok ok" }));
      assert.equal((await db.mandate.findUniqueOrThrow({ where: { id: mandate.id } })).feeAnomalyOverrideReason, null, "the acknowledgement rolled back with the failed issue");
    } finally { await support.installApprovedTemplate(db, "SIMPLE_ASSIGNMENT", "el"); }
  });

  it("the €14,600 rent example prints the rent as the price and the fee separately, never one as the other", async () => {
    const property = await mkProperty({ listingType: "RENT", price: null, monthlyRent: 14600, address: "Αλαμάνας 1", city: "Μαρούσι" });
    const { mandate } = await mkMandate({ property, feeBasis: "MONTHLY_RENT", feePercentage: 50, locale: "el" });
    await issueMandate(mandate.id, { acknowledgeFeeAnomaly: "Συμφωνημένο ποσοστό επί του μισθώματος" });
    const text = pdfText(await mandatePdf(mandate.id));
    assert.match(text, /14\.600/);
    assert.match(text, /7\.300/, "the fee (50 % of the rent) is shown as its own amount");
    assert.match(text, /Αλαμάνας 1/);
    const snap = issue.decryptSnapshot((await db.mandate.findUniqueOrThrow({ where: { id: mandate.id } })).issuanceSnapshotEncrypted!)!;
    assert.equal(snap.document.fee!.amounts!.net, 7300);
    assert.equal(snap.document.properties[0]!.price, 14600);
  });

  // ---- exclusive conflicts --------------------------------------------------------------

  it("an overlapping exclusive mandate is refused; a manager's recorded override lets it issue", async () => {
    const property = await mkProperty();
    const first = await exclusive({ property });
    await issueMandate(first.mandate.id);
    const second = await exclusive({ property, startsAt: new Date("2027-01-01"), endsAt: new Date("2027-06-30") });
    assert.ok((await blockedCodes(issueMandate(second.mandate.id)))!.includes("EXCLUSIVE_CONFLICT"));
    assert.ok((await auditTypes(second.mandate.id)).includes("EXCLUSIVE_CONFLICT_DETECTED"));
    await lib.recordConflictOverride(db, { mandateId: second.mandate.id, conflictingMandateId: first.mandate.id, reason: "Συμφωνία παράδοσης", approver: { id: manager.id, role: "MANAGER" } });
    const out = await issueMandate(second.mandate.id);
    assert.ok(out.number);
  });

  // ---- snapshots ----------------------------------------------------------------------

  it("the issued document is a snapshot: later edits or deletion of the property and contact do not change it", async () => {
    const { showing, properties, client } = await readyShowing();
    await issueShowing(showing.id);
    const row = await db.showing.findUniqueOrThrow({ where: { id: showing.id }, include: { properties: true, parties: true } });
    const before = { text: row.renderedTextChecksum, pdf: row.pdfChecksum, snap: row.issuanceSnapshotChecksum };
    await db.property.update({ where: { id: properties[0]!.id }, data: { address: "Άλλη διεύθυνση 99", price: 1 } });
    await db.contact.update({ where: { id: client.id }, data: { firstName: "Άλλος" } });
    const bytes = await issue.loadIssuedPdf(db, "SHOWING", showing.id);
    assert.equal(bytes.checksum, before.pdf);
    assert.ok(!pdfText(bytes.bytes).includes("Άλλη διεύθυνση 99"));
    await db.showingProperty.updateMany({ where: { showingId: showing.id }, data: { propertyId: null } }).catch(() => undefined);
    await db.property.delete({ where: { id: properties[0]!.id } }).catch(() => undefined);
    await db.contact.delete({ where: { id: client.id } }).catch(() => undefined);
    const after = await db.showing.findUniqueOrThrow({ where: { id: showing.id } });
    assert.deepEqual({ text: after.renderedTextChecksum, pdf: after.pdfChecksum, snap: after.issuanceSnapshotChecksum }, before);
    assert.equal(issue.decryptSnapshot(after.issuanceSnapshotEncrypted!)!.document.properties[0]!.address?.includes("Οδός Δοκιμής 5"), true, "the snapshot keeps the address as issued");
    assert.equal(sha(await store.read(row.pdfStorageKey!) as Buffer), before.pdf, "the stored object is the same bytes");
  });

  it("the snapshot of an issued showing is frozen in the database", async () => {
    const { showing } = await readyShowing();
    await issueShowing(showing.id);
    await assert.rejects(db.showing.update({ where: { id: showing.id }, data: { renderedTextChecksum: "x" } }), /cannot be edited/);
    await assert.rejects(db.showing.update({ where: { id: showing.id }, data: { issuanceSnapshotEncrypted: "x" } }), /cannot be edited/);
    await assert.rejects(db.showing.update({ where: { id: showing.id }, data: { pdfChecksum: "x" } }), /cannot be edited/);
    const { mandate } = await mkMandate();
    await issueMandate(mandate.id);
    await assert.rejects(db.mandate.update({ where: { id: mandate.id }, data: { issuanceSnapshotChecksum: "x" } }), /cannot be edited/);
  });

  it("several properties and several clients are all printed", async () => {
    const props = [await mkProperty({ address: "Α 1" }), await mkProperty({ address: "Β 2" }), await mkProperty({ address: "Γ 3" })];
    const { showing } = await readyShowing({ properties: props, parties: 2 });
    await issueShowing(showing.id);
    const text = pdfText((await issue.loadIssuedPdf(db, "SHOWING", showing.id)).bytes);
    for (const p of props) assert.ok(text.includes(p.reference), p.reference);
    assert.match(text, /Γιώργος Κωνσταντίνου/); assert.match(text, /Ελένη Κωνσταντίνου/);
    const snap = issue.decryptSnapshot((await db.showing.findUniqueOrThrow({ where: { id: showing.id } })).issuanceSnapshotEncrypted!)!;
    assert.equal(snap.document.properties.length, 3); assert.equal(snap.document.parties.length, 2);
  });

  // ---- idempotence and concurrency ---------------------------------------------------------

  it("issuing twice, or at the same time, yields one number and one PDF", async () => {
    const { showing } = await readyShowing();
    const results = await Promise.all([issueShowing(showing.id), issueShowing(showing.id), issueShowing(showing.id)]);
    assert.equal(new Set(results.map((r) => r.number)).size, 1);
    assert.equal(new Set(results.map((r) => r.pdfChecksum)).size, 1);
    assert.equal(results.filter((r) => !r.alreadyIssued).length, 1, "exactly one request did the work");
    const again = await issueShowing(showing.id);
    assert.equal(again.alreadyIssued, true);
    assert.equal(await db.documentAuditEvent.count({ where: { entityId: showing.id, type: "SHOWING_ISSUED" } }), 1);
    const keys = [...store.objects.keys()].filter((k) => k.includes(showing.id));
    assert.equal(keys.length, 1, "one final object, no stray staged copies");
  });

  it("numbers are consecutive and a failed issue gives its number back", async () => {
    const scope = "mandate-number";
    const a = await mkMandate(); const b = await mkMandate();
    const [x, y] = await Promise.all([issueMandate(a.mandate.id), issueMandate(b.mandate.id)]);
    assert.notEqual(x.number, y.number);
    const failing = await mkMandate({ feeMethod: null });
    const counterBefore = (await db.referenceCounter.findUnique({ where: { scope } }))!.nextValue;
    await blockedCodes(issueMandate(failing.mandate.id));
    assert.equal((await db.referenceCounter.findUnique({ where: { scope } }))!.nextValue, counterBefore, "no number consumed by a refused issue");
  });

  // ---- staged storage --------------------------------------------------------------------

  it("if the database fails after the upload, the staged object is removed and the document stays a draft", async () => {
    await db.$executeRawUnsafe(`ALTER TABLE document_audit_events ADD CONSTRAINT zz_test_fail CHECK (type <> 'SHOWING_PDF_GENERATED') NOT VALID`);
    try {
      const { showing } = await readyShowing();
      const staged: string[] = [];
      const put = store.put;
      store.put = async (key, body, ct) => { if (key.includes("staging")) staged.push(key); return put(key, body, ct); };
      await assert.rejects(issueShowing(showing.id));
      store.put = put;
      assert.equal(staged.length, 1, "the PDF was staged before the commit failed");
      assert.ok(!store.objects.has(staged[0]!), "the temporary object was cleaned up");
      const row = await db.showing.findUniqueOrThrow({ where: { id: showing.id } });
      assert.deepEqual([row.status === "ISSUED", row.number, row.pdfChecksum, row.storageState], [false, null, null, "NOT_STORED"]);
      assert.ok(![...store.objects.keys()].some((k) => k.includes(showing.id)), "no final PDF");
    } finally { await db.$executeRawUnsafe(`ALTER TABLE document_audit_events DROP CONSTRAINT zz_test_fail`); }
  });

  describe("if the final move fails after the commit", () => {
    let id = "";
    let finalKey = "";
    it("the document is issued but STORAGE_PENDING, and is not sent, signed or downloaded meanwhile", async () => {
      const { showing } = await readyShowing();
      id = showing.id;
      const original = store.put;
      store.put = async (key, body, ct) => { if (!key.includes("staging")) throw new Error("S3 unavailable"); return original(key, body, ct); };
      let out;
      try { out = await issueShowing(id); } finally { store.put = original; }
      assert.equal(out.storageState, "PENDING");
      finalKey = out.storageKey!;
      const row = await db.showing.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, "ISSUED"); assert.equal(row.storageState, "PENDING"); assert.ok(row.number);
      assert.ok(!store.objects.has(finalKey));
      await assert.rejects(issue.loadIssuedPdf(db, "SHOWING", id), (e: { code?: string }) => e.code === "STORAGE_PENDING");
      await assert.rejects(signing.sendDocumentForSignature(db, "SHOWING", id, { actor: manager }), (e: { code?: string }) => e.code === "STORAGE_PENDING");
      await assert.rejects(signing.recordPaperSignedCopy(db, "SHOWING", id, { storageKey: "private/documents/x.pdf", checksum: sha("scan"), byteSize: 4 }, { signedAt: new Date() }, { actor: manager }), (e: { code?: string }) => e.code === "STORAGE_PENDING");
      assert.ok((await auditTypes(id)).includes("DOCUMENT_STORAGE_PENDING"));
    });
    it("recovery re-creates the identical PDF from the snapshot and confirms it", async () => {
      const row = await db.showing.findUniqueOrThrow({ where: { id } });
      const r = await issue.recoverPendingStorage(db);
      assert.ok(r.confirmed >= 1);
      const after = await db.showing.findUniqueOrThrow({ where: { id } });
      assert.equal(after.storageState, "CONFIRMED");
      assert.equal(sha(store.objects.get(finalKey)!.body), row.pdfChecksum, "the recovered bytes are exactly the issued ones");
      assert.ok((await auditTypes(id)).includes("DOCUMENT_STORAGE_CONFIRMED"));
      assert.ok((await issue.loadIssuedPdf(db, "SHOWING", id)).bytes.length > 0);
    });
  });

  it("a stored PDF that no longer matches its checksum is never handed out", async () => {
    const { showing } = await readyShowing();
    await issueShowing(showing.id);
    const row = await db.showing.findUniqueOrThrow({ where: { id: showing.id } });
    store.objects.get(row.pdfStorageKey!)!.body = Buffer.from("%PDF tampered");
    await assert.rejects(issue.loadIssuedPdf(db, "SHOWING", showing.id), (e: { code?: string }) => e.code === "PDF_INTEGRITY");
  });

  // ---- audit ----------------------------------------------------------------------------

  it("every step is audited, append-only, with the actor, and without personal data", async () => {
    const { showing } = await readyShowing();
    await issueShowing(showing.id);
    const types = await auditTypes(showing.id);
    for (const t of ["TEMPLATE_RESOLVED", "TEMPLATE_CHECKSUM_VERIFIED", "SHOWING_ISSUED", "SHOWING_PDF_GENERATED", "DOCUMENT_STORAGE_CONFIRMED"]) assert.ok(types.includes(t as never), t);
    const events = await db.documentAuditEvent.findMany({ where: { entityId: showing.id } });
    for (const e of events) { assert.equal(e.actorUserId, manager.id); assert.equal(e.actorRole, "MANAGER"); assert.ok(e.occurredAt); assert.equal(e.entityType, "SHOWING"); }
    const dump = JSON.stringify(events);
    for (const secret of ["123456780", "ΑΒ123456", "Οδός Πελάτη 1", "6900000000", "g@test.invalid", "Γιώργος Κωνσταντίνου"]) assert.ok(!dump.includes(secret), `${secret} must not be in the audit trail`);
    assert.ok(events.find((e) => e.type === "SHOWING_ISSUED")!.documentNumber);
    await assert.rejects(db.documentAuditEvent.update({ where: { id: events[0]!.id }, data: { reason: "x" } }), /append-only|cannot be/i);
    await assert.rejects(db.documentAuditEvent.delete({ where: { id: events[0]!.id } }), /append-only|cannot be/i);
  });

  // ---- signing --------------------------------------------------------------------------

  describe("signing", () => {
    it("the provider receives exactly the issued PDF and its checksum, at the configured level", async () => {
      const { showing } = await readyShowing();
      await issueShowing(showing.id);
      const r = await signing.sendDocumentForSignature(db, "SHOWING", showing.id, { actor: manager });
      const row = await db.showing.findUniqueOrThrow({ where: { id: showing.id } });
      assert.equal(sha(sentPdf!), row.pdfChecksum);
      assert.equal(sentChecksum, row.pdfChecksum);
      assert.equal(sentLevel, "ADVANCED", "the provider's configured level is kept, not upgraded or downgraded");
      assert.equal(row.signatureLevel, "ADVANCED"); assert.equal(row.status, "SENT");
      assert.equal(r.documentChecksum, row.pdfChecksum);
      await assert.rejects(signing.sendDocumentForSignature(db, "SHOWING", showing.id, { actor: manager }), (e: { code?: string }) => e.code === "ALREADY_SENT");
      assert.ok((await auditTypes(showing.id)).includes("SHOWING_SENT"));
    });

    it("a paper-signed copy is its own artifact: the original is never overwritten, the level is SIMPLE", async () => {
      const { showing } = await readyShowing();
      await issueShowing(showing.id);
      const original = await db.showing.findUniqueOrThrow({ where: { id: showing.id } });
      const originalBytes = Buffer.from(store.objects.get(original.pdfStorageKey!)!.body);
      const scan = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(64)]);
      const scanKey = `private/documents/showings/${showing.id}/signed/scan-${sha(scan).slice(0, 16)}.pdf`;
      await store.put(scanKey, scan, "application/pdf");
      await assert.rejects(signing.recordPaperSignedCopy(db, "SHOWING", showing.id, { storageKey: original.pdfStorageKey!, checksum: original.pdfChecksum!, byteSize: 1 }, { signedAt: new Date() }, { actor: manager }), (e: { code?: string }) => e.code === "SAME_AS_ORIGINAL");
      await assert.rejects(signing.recordPaperSignedCopy(db, "SHOWING", showing.id, { storageKey: scanKey, checksum: sha(scan), byteSize: scan.length }, { signedAt: new Date(Date.now() + 5 * 86_400_000) }, { actor: manager }), (e: { code?: string }) => e.code === "INVALID_DATE");
      await signing.recordPaperSignedCopy(db, "SHOWING", showing.id, { storageKey: scanKey, checksum: sha(scan), byteSize: scan.length }, { signedAt: new Date(), signerNote: "ο πελάτης" }, { actor: manager });
      const signed = await db.showing.findUniqueOrThrow({ where: { id: showing.id } });
      assert.equal(signed.status, "SIGNED"); assert.equal(signed.signatureMethod, "PAPER"); assert.equal(signed.signatureLevel, "SIMPLE");
      assert.equal(signed.signedPdfChecksum, sha(scan));
      assert.notEqual(signed.signedPdfChecksum, signed.pdfChecksum);
      assert.equal(signed.signedUploadedById, manager.id); assert.ok(signed.signedUploadedAt);
      assert.equal(signed.pdfChecksum, original.pdfChecksum);
      assert.ok(originalBytes.equals(store.objects.get(original.pdfStorageKey!)!.body), "the original PDF is byte-for-byte unchanged");
      assert.equal(signed.pdfStorageKey, original.pdfStorageKey);
      assert.ok((await auditTypes(showing.id)).includes("SHOWING_SIGNED"));
    });
  });

  // ---- replacement ------------------------------------------------------------------------

  it("a correction is a replacement: new number and PDF, linked, and the original is cancelled but kept", async () => {
    const { showing } = await readyShowing();
    await issueShowing(showing.id);
    const original = await db.showing.findUniqueOrThrow({ where: { id: showing.id } });
    const replacement = await db.showing.create({ data: { language: "el", contactId: original.contactId, responsibleUserId: agent.id, replacesShowingId: showing.id, ...goodFee } });
    const prop = await db.showingProperty.findFirstOrThrow({ where: { showingId: showing.id } });
    await lib.addPropertyToShowing(db, replacement.id, prop.propertyId!);
    const party = await db.showingParty.findFirstOrThrow({ where: { showingId: showing.id } });
    await db.showingParty.create({ data: { showingId: replacement.id, role: party.role, fullName: party.fullName, sortOrder: 0, taxIdEncrypted: party.taxIdEncrypted, taxOfficeEncrypted: party.taxOfficeEncrypted, idNumberEncrypted: party.idNumberEncrypted, addressEncrypted: party.addressEncrypted, phoneEncrypted: party.phoneEncrypted, emailEncrypted: party.emailEncrypted, identityVerifiedAt: new Date() } });
    const out = await issueShowing(replacement.id);
    assert.notEqual(out.number, original.number);
    const [o, r] = await Promise.all([db.showing.findUniqueOrThrow({ where: { id: showing.id } }), db.showing.findUniqueOrThrow({ where: { id: replacement.id } })]);
    assert.equal(o.status, "CANCELLED"); assert.equal(r.status, "ISSUED"); assert.equal(r.replacesShowingId, showing.id);
    assert.equal(o.pdfChecksum, original.pdfChecksum, "the original PDF and number are kept as history");
    assert.ok(store.objects.has(o.pdfStorageKey!));
    assert.notEqual(r.pdfChecksum, o.pdfChecksum);
    assert.ok((await auditTypes(showing.id)).includes("SHOWING_REPLACED"));
    await assert.rejects(db.showing.create({ data: { language: "el", replacesShowingId: showing.id } }), /Unique constraint/, "an original is replaced at most once");
  });

  it("a signed original stays signed history when replaced", async () => {
    const { showing } = await readyShowing();
    await issueShowing(showing.id);
    const scan = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(32)]);
    const key = `private/documents/showings/${showing.id}/signed/s.pdf`;
    await store.put(key, scan, "application/pdf");
    await signing.recordPaperSignedCopy(db, "SHOWING", showing.id, { storageKey: key, checksum: sha(scan), byteSize: scan.length }, { signedAt: new Date() }, { actor: manager });
    const row = await db.showing.findUniqueOrThrow({ where: { id: showing.id } });
    const replacement = await db.showing.create({ data: { language: "el", contactId: row.contactId, responsibleUserId: agent.id, replacesShowingId: showing.id, ...goodFee } });
    const prop = await db.showingProperty.findFirstOrThrow({ where: { showingId: showing.id } });
    await lib.addPropertyToShowing(db, replacement.id, prop.propertyId!);
    const party = await db.showingParty.findFirstOrThrow({ where: { showingId: showing.id } });
    await db.showingParty.create({ data: { showingId: replacement.id, role: party.role, fullName: party.fullName, sortOrder: 0, taxIdEncrypted: party.taxIdEncrypted, taxOfficeEncrypted: party.taxOfficeEncrypted, idNumberEncrypted: party.idNumberEncrypted, addressEncrypted: party.addressEncrypted, phoneEncrypted: party.phoneEncrypted, emailEncrypted: party.emailEncrypted, identityVerifiedAt: new Date() } });
    await issueShowing(replacement.id);
    assert.equal((await db.showing.findUniqueOrThrow({ where: { id: showing.id } })).status, "SIGNED");
  });

  it("an issued mandate is replaced through supersedes: the new one is issued, the old one cancelled and linked", async () => {
    const property = await mkProperty();
    const first = await mkMandate({ property });
    await issueMandate(first.mandate.id);
    const next = await mkMandate({ property, supersedesMandateId: first.mandate.id });
    const out = await issueMandate(next.mandate.id);
    assert.notEqual(out.number, (await db.mandate.findUniqueOrThrow({ where: { id: first.mandate.id } })).number);
    assert.equal((await db.mandate.findUniqueOrThrow({ where: { id: first.mandate.id } })).status, "CANCELLED");
    assert.ok((await auditTypes(first.mandate.id)).includes("MANDATE_REPLACED"));
  });

  // ---- extensions ----------------------------------------------------------------------------

  it("an extension is its own document: own number, own PDF, linked to the signed mandate, original untouched", async () => {
    const { mandate } = await exclusive({ endsAt: new Date("2027-04-30") });
    await issueMandate(mandate.id);
    await db.mandate.update({ where: { id: mandate.id }, data: { status: "SIGNED", signedAt: new Date(), signatureMethod: "PAPER" } });
    const mandateRow = await db.mandate.findUniqueOrThrow({ where: { id: mandate.id } });
    const x = await lib.createMandateExtension(db, { mandateId: mandate.id, newEndDate: "2027-07-31", reason: "Συμφωνία", actor: { id: manager.id, name: manager.name } });
    const out = await issue.issueDocument(db, "MANDATE_EXTENSION", x.id, { actor: manager });
    assert.equal(out.storageState, "CONFIRMED");
    const row = await db.mandateExtension.findUniqueOrThrow({ where: { id: x.id } });
    assert.equal(row.status, "ISSUED");
    assert.equal(row.number, `${mandateRow.number}/Π1`);
    assert.ok(row.pdfStorageKey!.startsWith(`private/documents/mandates/${mandate.id}/extensions/`), row.pdfStorageKey!);
    assert.equal(sha(store.objects.get(row.pdfStorageKey!)!.body), row.pdfChecksum);
    const text = pdfText((await issue.loadIssuedPdf(db, "MANDATE_EXTENSION", x.id)).bytes);
    assert.ok(text.includes(mandateRow.number!) && text.includes("30/04/2027") && text.includes("31/07/2027"), text.slice(0, 400));
    assert.equal((await db.mandate.findUniqueOrThrow({ where: { id: mandate.id } })).endsAt!.toISOString().slice(0, 10), "2027-04-30", "the mandate's own end date is never overwritten");
    const again = await issue.issueDocument(db, "MANDATE_EXTENSION", x.id, { actor: manager });
    assert.equal(again.alreadyIssued, true);
    // Paper-signed: separate artifact, level SIMPLE.
    const scan = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(32)]);
    const key = `private/documents/mandates/${mandate.id}/extensions/signed-${RUN}.pdf`;
    await store.put(key, scan, "application/pdf");
    await signing.recordPaperSignedCopy(db, "MANDATE_EXTENSION", x.id, { storageKey: key, checksum: sha(scan), byteSize: scan.length }, { signedAt: new Date() }, { actor: manager });
    const signed = await db.mandateExtension.findUniqueOrThrow({ where: { id: x.id } });
    assert.equal(signed.status, "SIGNED"); assert.equal(signed.signatureLevel, "SIMPLE"); assert.equal(signed.pdfChecksum, row.pdfChecksum); assert.equal(signed.signedPdfChecksum, sha(scan));
    assert.equal((await lib.currentEndDate(db, mandate.id))!.toISOString().slice(0, 10), "2027-07-31");
    assert.ok((await auditTypes(x.id)).includes("EXTENSION_ISSUED"));
  });

  // ---- private keys ------------------------------------------------------------------------------

  it("every stored object is under the private prefix with an ASCII, immutable key; no overwrite", async () => {
    const keys = [...store.objects.keys()];
    assert.ok(keys.length > 5);
    for (const k of keys) { assert.ok(k.startsWith("private/documents/"), k); assert.match(k, /^[\x21-\x7e]+$/, `ASCII key: ${k}`); }
    const { showing } = await readyShowing();
    await issueShowing(showing.id);
    const row = await db.showing.findUniqueOrThrow({ where: { id: showing.id } });
    assert.match(row.pdfStorageKey!, /issued\/[A-Za-z0-9._-]+\.pdf$/);
    assert.ok(![...store.objects.keys()].some((k) => k.includes("/staging/") && store.objects.get(k)!.body.length > 0 && k.includes(showing.id)));
    assert.notEqual(issue.issuedStorageKey("SHOWING", "s1", "ΥΠ-2026-000001", "a".repeat(64)), issue.issuedStorageKey("SHOWING", "s1", "ΥΠ-2026-000001", "b".repeat(64)), "a different text never maps to an existing key");
  });
});
