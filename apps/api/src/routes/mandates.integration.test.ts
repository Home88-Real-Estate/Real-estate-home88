/**
 * End-to-end test of documents and digital mandates through the real API and
 * a real Postgres, with an in-memory object store and a fake e-signature
 * adapter. Runs only when TEST_DATABASE_URL points at a disposable database
 * with all migrations applied:
 *
 *   TEST_DATABASE_URL=postgresql://… npx tsx --test src/routes/mandates.integration.test.ts
 *
 * The template text below is a placeholder for testing, not mandate wording.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("documents and mandates: templates, issuing, immutability, paper and e-signature, privacy", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { memoryDocumentStore, setDocumentStore } = await import("../lib/document-store");
  const { setSignatureProvider } = await import("../providers/signature");
  const { PDFDocument } = await import("pdf-lib");

  // Start from unconfigured mandate settings so the test can be re-run.
  await db().mandateSettings.deleteMany({});
  await db().companyLegalDetails.deleteMany({});
  await db().mandateTemplateVersion.updateMany({ where: { status: { in: ["ACTIVE", "DRAFT"] } }, data: { status: "RETIRED", retiredAt: new Date() } });

  const store = memoryDocumentStore();
  setDocumentStore(store);

  const run = randomBytes(4).toString("hex");
  const RUN = run.toUpperCase();
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) =>
    db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
  const [agentUser, other, manager, admin, superAdmin] = await Promise.all([mk("AGENT", "magent"), mk("AGENT", "magent2"), mk("MANAGER", "mmanager"), mk("ADMIN", "madmin"), mk("SUPER_ADMIN", "msuper")]);
  const property = await db().property.create({
    data: {
      reference: `MND-P${RUN}`, slug: `mnd-p-${run}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Δοκιμή", descriptionEl: "Δοκιμή",
      city: "Αθήνα", areaName: "Κουκάκι", address: "Οδός Δοκιμής 1", area: 90, floor: 2, status: "ACTIVE", agentId: agentUser.id,
    },
  });

  async function login(email: string) {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }
  const [agentCookie, otherCookie, managerCookie, adminCookie, superCookie] = await Promise.all([login(agentUser.email), login(other.email), login(manager.email), login(admin.email), login(superAdmin.email)]);
  const call = async (cookie: string | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  };
  /** Upload bytes the way the browser does: ask for a URL, PUT to it, return the token. */
  const upload = async (cookie: string, bytes: Buffer, mimeType: string) => {
    const r = await call(cookie, "POST", "/documents/uploads", { fileName: "f", mimeType, byteSize: bytes.length });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await store.put(String(r.body.upload.url).replace("memory://", ""), bytes, mimeType);
    return r.body.token as string;
  };

  // The property's registered owner (Phase A ownership model).
  const ownerContact = await db().contact.create({ data: { reference: `OWN-${RUN}`, firstName: "Ελένη", lastName: "Π." } });
  await db().propertyOwner.create({ data: { propertyId: property.id, contactId: ownerContact.id, capacity: "OWNER", ownershipPercentage: 100, isPrimaryContact: true, isSignatory: true } });

  // Owner with contact details (encrypted), as in Phase 3.
  const seller = await call(agentCookie, "POST", "/sellers", {
    listingType: "SALE", firstName: "Ελένη", lastName: "Π.", phone: "6977000000", email: `owner-m-${run}@test.invalid`, propertyReference: property.reference,
  });
  assert.equal(seller.status, 200, JSON.stringify(seller.body));
  const sellerId = seller.body.seller.id as string;

  // Draft from the owner: the owner becomes the principal automatically.
  const start = "2026-11-01";
  const STRUCT = {
    feePayer: "OWNER", feeMethod: "PERCENTAGE", feeBasis: "ASKING_PRICE", feePercentage: 2, feeCurrency: "EUR", vatTreatment: "PLUS_VAT", vatRate: 24, paymentTrigger: "FINAL_CONTRACT",
    knownDefects: false, defectsDisclosureConfirmed: true, photoPermission: true, videoPermission: true, floorplanPermission: true, signboardPermission: false, portalPublicationPermission: true,
    socialMediaPermission: false, cooperatingBrokerPermission: false, brokerCooperationAllowed: false, dualRepresentationConsent: false, durationType: "FIXED_TERM",
  };
  const created = await call(agentCookie, "POST", "/mandates", {
    type: "EXCLUSIVE_ASSIGNMENT", sellerLeadId: sellerId, startsAt: start, endsAt: "2027-04-30", ...STRUCT,
    terms: { price: 250000, commission: "[όρος αμοιβής δοκιμής]", cadastralCode: "KAEK-TEST" },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const m1 = created.body.mandate.id as string;

  let detail = await call(agentCookie, "GET", `/mandates/${m1}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.mandate.parties[0].phone, "6977000000", "principal from the owner record, decrypted for the agent");
  assert.equal(detail.body.readiness.templateMissing, true);
  assert.equal((await call(otherCookie, "GET", `/mandates/${m1}`)).status, 404, "other agents cannot see it");
  const party = await db().mandateParty.findFirstOrThrow({ where: { mandateId: m1 } });
  assert.ok(party.phoneEncrypted?.startsWith("v1:") && !JSON.stringify(party).includes("6977000000"), "party details encrypted at rest");

  // Not ready: the exact blocking reasons are returned and nothing is issued.
  let issue = await call(managerCookie, "POST", `/mandates/${m1}/issue`, {});
  assert.equal(issue.status, 422, JSON.stringify(issue.body));
  assert.equal(issue.body.error.code, "document_blocked");
  assert.ok(issue.body.error.fields.template && issue.body.error.fields.company, JSON.stringify(issue.body.error.fields));
  assert.equal((await call(agentCookie, "POST", `/mandates/${m1}/issue`, {})).status, 403, "agents prepare drafts; managers issue");
  assert.equal((await call(adminCookie, "PUT", "/settings/sections/mandates", { values: { numberingPrefix: `T${RUN.slice(0, 4)}`, numberingDigits: 5, retentionYears: 10 } })).status, 200);
  assert.equal((await db().mandate.findUniqueOrThrow({ where: { id: m1 } })).number, null, "a refused issue leaves a draft with no number");
  // The principal's identity, as the agent enters it.
  assert.equal((await call(agentCookie, "PATCH", `/mandates/${m1}`, { parties: [{ fullName: "Ελένη Π.", phone: "6977000000", taxId: "123456783", idNumber: "ΑΒ123456", address: "Οδός Δοκιμής 7, Αθήνα" }] })).status, 200);

  // A template with a typo is refused when it is saved, so it can never reach a client.
  const tplPath = "/settings/mandates/templates/EXCLUSIVE_ASSIGNMENT/el/versions";
  const bad = await call(adminCookie, "POST", tplPath, { body: "[ΔΟΚΙΜΑΣΤΙΚΟ ΠΡΟΤΥΠΟ] {{mandate.number}} {{owner.name}} {{property.reference}}" });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  assert.match(bad.body.error.message, /owner\.name/);

  // Template wording is drafted by an admin, submitted for review, approved by counsel (a flagged user) and only then activated.
  const BODY = "{{document.number}} — {{document.date}}\n{{principal.fullName}} αναθέτει στο γραφείο {{company.legalName}} το ακίνητο {{properties.references}}. Είδος: {{term.type}}. Από {{term.startDate}} έως {{term.endDate}} ({{term.duration}}). Αμοιβή: {{fee.summary}}.";
  assert.equal((await call(agentCookie, "POST", tplPath, { body: BODY })).status, 403, "agents cannot draft templates");
  const drafted = await call(adminCookie, "POST", tplPath, { body: BODY });
  assert.equal(drafted.status, 200, JSON.stringify(drafted.body));
  const good = await db().mandateTemplateVersion.findFirstOrThrow({ where: { template: { type: "EXCLUSIVE_ASSIGNMENT", locale: "el" }, status: "DRAFT" }, orderBy: { version: "desc" } });
  assert.equal((await call(adminCookie, "POST", `/settings/mandates/versions/${good.id}/activate`, {})).status, 409, "no activation without counsel's approval");
  assert.equal((await call(adminCookie, "POST", `/settings/mandates/versions/${good.id}/submit-for-review`, {})).status, 200);
  assert.equal((await call(adminCookie, "POST", `/settings/mandates/versions/${good.id}/approve-legal`, { checksum: good.checksum })).status, 403, "admin is not counsel");
  assert.equal((await call(superCookie, "POST", `/settings/mandates/versions/${good.id}/approve-legal`, { checksum: good.checksum })).status, 403, "the permission alone is not enough: the user must be a legal approver");
  assert.equal((await call(adminCookie, "POST", `/settings/users/${superAdmin.id}/legal-approver`, { legalApprover: true })).status, 403, "only a system administrator names legal approvers");
  assert.equal((await call(superCookie, "POST", `/settings/users/${superAdmin.id}/legal-approver`, { legalApprover: true })).status, 200);
  assert.equal((await call(superCookie, "POST", `/settings/mandates/versions/${good.id}/approve-legal`, { checksum: "0".repeat(64) })).status, 409, "approval is of an exact text");
  assert.equal((await call(superCookie, "POST", `/settings/mandates/versions/${good.id}/approve-legal`, { checksum: good.checksum })).status, 200);
  assert.equal((await call(adminCookie, "POST", `/settings/mandates/versions/${good.id}/activate`, {})).status, 200);
  const approved = await db().mandateTemplateVersion.findUniqueOrThrow({ where: { id: good.id } });
  assert.equal(approved.legalApprovedChecksum, approved.checksum);
  assert.equal((await db().documentAuditEvent.count({ where: { type: "TEMPLATE_LEGAL_APPROVED", entityId: good.id } })), 1);

  // Company legal details still empty → the missing fields are named; nothing is invented.
  issue = await call(managerCookie, "POST", `/mandates/${m1}/issue`, {});
  assert.equal(issue.status, 422);
  assert.ok(issue.body.error.fields.company.some((m: string) => m.includes("Επωνυμία")), JSON.stringify(issue.body.error.fields));
  { const r = await call(adminCookie, "PUT", "/settings/sections/legal", { values: { legalNameEl: "ΔΟΚΙΜΗ Μ.Ι.Κ.Ε.", vatNumber: "123456783", taxOffice: "ΔΟΥ Δοκιμής", registeredAddressEl: "Οδός 1, Αθήνα", phone: "2100000000" } }); assert.equal(r.status, 200, JSON.stringify(r.body)); }

  // Issue.
  issue = await call(managerCookie, "POST", `/mandates/${m1}/issue`, {});
  assert.equal(issue.status, 200, JSON.stringify(issue.body));
  assert.match(issue.body.number, new RegExp(`^T${RUN.slice(0, 4)}-\\d{5}$`));
  let row = await db().mandate.findUniqueOrThrow({ where: { id: m1 }, include: { pdfDocument: true } });
  assert.equal(row.status, "ISSUED");
  assert.ok(row.renderedTextEncrypted?.startsWith("v1:"), "rendered text (personal data) stored encrypted");
  const pdf = store.objects.get(row.pdfDocument!.storageKey)!.body;
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  const { createHash } = await import("node:crypto");
  assert.equal(createHash("sha256").update(pdf).digest("hex"), row.pdfChecksum);
  assert.ok(row.pdfDocument!.storageKey.startsWith("private/documents/"), "private key space");
  assert.equal((await PDFDocument.load(pdf)).getTitle(), `Αποκλειστική Εντολή Ανάθεσης ${row.number}`);
  detail = await call(agentCookie, "GET", `/mandates/${m1}`);
  assert.match(detail.body.mandate.text, /Ελένη/);
  assert.match(detail.body.mandate.text, /Αποκλειστική/);

  // Frozen: API and database.
  assert.equal((await call(agentCookie, "PATCH", `/mandates/${m1}`, { terms: { price: 1 } })).status, 409);
  await assert.rejects(db().mandate.update({ where: { id: m1 }, data: { renderedChecksum: "x" } }));
  await assert.rejects(db().mandate.update({ where: { id: m1 }, data: { terms: {} } }));
  await assert.rejects(db().mandate.delete({ where: { id: m1 } }));
  await assert.rejects(db().mandateParty.update({ where: { id: party.id }, data: { fullName: "Άλλος" } }));
  await assert.rejects(db().mandateParty.create({ data: { mandateId: m1, role: "OWNER", fullName: "Επιπλέον" } }));
  assert.equal((await call(managerCookie, "DELETE", `/documents/${row.pdfDocumentId}`)).status, 409, "a mandate PDF cannot be deleted");

  // Documents: visibility and download.
  assert.equal((await call(otherCookie, "GET", `/documents/${row.pdfDocumentId}/download`)).status, 404);
  const dl = await call(agentCookie, "GET", `/documents/${row.pdfDocumentId}/download`);
  assert.equal(dl.status, 200);
  assert.ok(String(dl.body.url).includes(row.pdfDocument!.storageKey));
  const otherList = await call(otherCookie, "GET", `/documents?propertyId=${property.id}`);
  assert.equal(otherList.body.data.length, 0);

  const held = await db().document.create({
    data: { title: "Σε καραντίνα", storageKey: "private/documents/2026/10/" + "0".repeat(32) + ".pdf", mimeType: "application/pdf", byteSize: 1, propertyId: property.id, lifecycle: "QUARANTINED", uploadedById: agentUser.id },
  });
  assert.equal((await call(managerCookie, "GET", `/documents/${held.id}/download`)).status, 404, "unprocessed files are never handed out");
  assert.ok(!(await call(managerCookie, "GET", `/documents?propertyId=${property.id}`)).body.data.some((d: any) => d.id === held.id));

  // Overlapping exclusive mandate on the same property is refused.
  const m2 = (await call(agentCookie, "POST", "/mandates", {
    type: "EXCLUSIVE_ASSIGNMENT", propertyReference: property.reference, startsAt: "2027-01-01", endsAt: "2027-06-30", ...STRUCT,
    terms: { price: 240000, commission: "[δοκιμή]", cadastralCode: "KAEK-TEST" }, parties: [{ fullName: "Ελένη Π.", phone: "6977000000", taxId: "123456783", idNumber: "ΑΒ123456", address: "Οδός Δοκιμής 7, Αθήνα" }],
  })).body.mandate.id as string;
  issue = await call(managerCookie, "POST", `/mandates/${m2}/issue`, {});
  assert.equal(issue.status, 422, JSON.stringify(issue.body));
  assert.ok(issue.body.error.fields.dates[0].includes("αποκλειστική"), "the conflict names the other mandate");

  // Paper signature: a wrong file is refused, the real one signs.
  assert.equal((await call(managerCookie, "POST", `/mandates/${m1}/send`, {})).status, 409, "no provider configured");
  const fakePdf = await upload(managerCookie, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), "application/pdf");
  assert.equal((await call(managerCookie, "POST", `/mandates/${m1}/signed-copy`, { token: fakePdf })).status, 400, "content must match the type");
  const signedScan = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(64)]);
  const token = await upload(managerCookie, signedScan, "application/pdf");
  assert.equal((await call(otherCookie, "POST", `/mandates/${m1}/signed-copy`, { token })).status, 403, "agents cannot record signatures");
  const signed = await call(managerCookie, "POST", `/mandates/${m1}/signed-copy`, { token, signedAt: new Date().toISOString().slice(0, 10) });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  const signedRow = await db().mandate.findUniqueOrThrow({ where: { id: m1 }, include: { pdfDocument: true, signedDocument: true } });
  assert.equal(signedRow.status, "SIGNED");
  assert.equal(signedRow.signatureMethod, "PAPER");
  assert.equal(signedRow.signedChecksum, createHash("sha256").update(signedScan).digest("hex"));
  assert.ok(signedRow.signedDocument?.retentionExpiresAt && signedRow.pdfDocument?.retentionExpiresAt, "retention from Settings applied");
  assert.equal((await call(managerCookie, "POST", `/mandates/${m1}/cancel`, { reason: "x" })).status, 409, "signed is final");
  await assert.rejects(db().mandate.update({ where: { id: m1 }, data: { status: "CANCELLED" } }), "database keeps it final");
  assert.equal((await call(managerCookie, "POST", `/mandates/${m1}/signed-copy`, { token })).status, 409);

  // ---------------------------------------------------------------------------
  // Access control for issued PDFs, signed copies and addenda. Not merely "the key starts with private/":
  // every route that can hand a document out is exercised as an anonymous caller, a role without the
  // permission, an agent who does not own the record, and the people who may have it.
  // ---------------------------------------------------------------------------
  const viewerUser = await mk("VIEWER", "mviewer");
  const viewerCookie = await login(viewerUser.email);
  const mandateRow = await db().mandate.findUniqueOrThrow({ where: { id: m1 }, include: { pdfDocument: true, signedDocument: true } });
  const originalPdf = Buffer.from(store.objects.get(mandateRow.pdfDocument!.storageKey)!.body);

  const assertCannotFetch = async (path: string) => {
    assert.equal((await call(null, "GET", path)).status, 401, `anonymous: ${path}`);
    assert.equal((await call(viewerCookie, "GET", path)).status, 403, `no permission: ${path}`);
    assert.equal((await call(otherCookie, "GET", path)).status, 404, `not the owner's record: ${path}`);
  };
  const assertShortLivedSignedLink = (body: any, key: string) => {
    assert.equal(body.expiresInSeconds, 120, "short-lived");
    // The in-memory store signs as memory://<key>; the S3 store signs with an expiring signature (unit-tested separately).
    assert.equal(body.url, `memory://${key}`);
    assert.ok(!("storageKey" in body) && !("key" in body), "no bare storage key in the response");
  };

  await assertCannotFetch(`/mandates/${m1}/pdf`);
  const mandatePdf = await call(agentCookie, "GET", `/mandates/${m1}/pdf`);
  assert.equal(mandatePdf.status, 200, JSON.stringify(mandatePdf.body));
  assertShortLivedSignedLink(mandatePdf.body, mandateRow.pdfDocument!.storageKey);
  assert.equal((await call(managerCookie, "GET", `/mandates/${m1}/pdf`)).status, 200, "a manager may fetch any mandate");

  // The paper-signed copy is a Document: the same wall around it.
  const signedId = mandateRow.signedDocumentId!;
  assert.equal((await call(null, "GET", `/documents/${signedId}/download`)).status, 401);
  assert.equal((await call(viewerCookie, "GET", `/documents/${signedId}/download`)).status, 403);
  assert.equal((await call(otherCookie, "GET", `/documents/${signedId}/download`)).status, 404);
  const signedDl = await call(agentCookie, "GET", `/documents/${signedId}/download`);
  assert.equal(signedDl.status, 200, JSON.stringify(signedDl.body));
  assert.equal(signedDl.body.url, `memory://${mandateRow.signedDocument!.storageKey}`);
  assert.equal(signedDl.body.expiresInSeconds, 120);
  // Guessing a key does not help: downloads are by document id, checked against the caller; keys are not routes.
  const guessed = await call(agentCookie, "GET", `/documents/${encodeURIComponent(mandateRow.pdfDocument!.storageKey)}/download`);
  assert.ok([400, 404, 414].includes(guessed.status) && !guessed.body.url, `a storage key is not a download route (${guessed.status})`);

  // An addendum: its own document, number, PDF and checksum; the signed original is untouched.
  assert.equal((await call(viewerCookie, "POST", `/mandates/${m1}/extensions`, { newEndDate: "2027-10-30" })).status, 403);
  assert.equal((await call(otherCookie, "POST", `/mandates/${m1}/extensions`, { newEndDate: "2027-10-30" })).status, 403, "agents do not hold mandates.extend");
  const ext = await call(managerCookie, "POST", `/mandates/${m1}/extensions`, { newEndDate: "2027-10-30", reason: "Παράταση για δοκιμή" });
  assert.equal(ext.status, 200, JSON.stringify(ext.body));
  const extId = ext.body.extension.id as string;
  const { installApprovedTemplate } = await import("../lib/brokerage/documents/test-support");
  await installApprovedTemplate(db(), "MANDATE_EXTENSION", "el");
  assert.equal((await call(managerCookie, "GET", `/mandate-extensions/${extId}/pdf`)).status, 409, "no PDF before the addendum is issued");
  const extIssued = await call(managerCookie, "POST", `/mandate-extensions/${extId}/issue`, {});
  assert.equal(extIssued.status, 200, JSON.stringify(extIssued.body));
  const extRow = await db().mandateExtension.findUniqueOrThrow({ where: { id: extId } });
  assert.ok(extRow.number?.startsWith(`${mandateRow.number}/`), `the addendum number derives from the mandate number: ${extRow.number}`);
  assert.equal(extRow.previousEndDate.toISOString().slice(0, 10), "2027-04-30");
  assert.equal(extRow.newEndDate.toISOString().slice(0, 10), "2027-10-30");
  assert.ok(extRow.pdfChecksum && extRow.pdfChecksum !== mandateRow.pdfChecksum, "its own checksum");
  assert.notEqual(extRow.pdfStorageKey, mandateRow.pdfDocument!.storageKey, "its own object");
  assert.ok(extRow.pdfStorageKey!.startsWith("private/documents/"));
  assert.ok(originalPdf.equals(store.objects.get(mandateRow.pdfDocument!.storageKey)!.body), "the original mandate PDF is byte-for-byte unchanged");
  const extBytes = store.objects.get(extRow.pdfStorageKey!)!.body;
  assert.equal(createHash("sha256").update(extBytes).digest("hex"), extRow.pdfChecksum);
  if (process.env.H88_DUMP_DIR) {
    // Optional, for manual visual inspection of the rendered documents.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${process.env.H88_DUMP_DIR}/mandate.pdf`, originalPdf);
    writeFileSync(`${process.env.H88_DUMP_DIR}/extension.pdf`, extBytes);
  }

  await assertCannotFetch(`/mandate-extensions/${extId}/pdf`);
  const extPdf = await call(agentCookie, "GET", `/mandate-extensions/${extId}/pdf`);
  assert.equal(extPdf.status, 200, JSON.stringify(extPdf.body));
  assertShortLivedSignedLink(extPdf.body, extRow.pdfStorageKey!);
  assert.equal((await call(otherCookie, "POST", `/mandate-extensions/${extId}/signed-copy`, { token: "x".repeat(20) })).status, 403, "an agent cannot attach a signed copy");
  assert.equal((await call(null, "POST", `/mandate-extensions/${extId}/signed-copy`, { token: "x".repeat(20) })).status, 401);

  // Public verification: confirms a document exists; never a way to read it.
  const verify = await call(null, "GET", `/verify/${extRow.verificationCode}`);
  assert.equal(verify.status, 200);
  assert.deepEqual(Object.keys(verify.body), ["document"]);
  assert.deepEqual(Object.keys(verify.body.document).sort(), ["checksumPrefix", "issuedAt", "number", "status", "type"]);
  const publicText = JSON.stringify(verify.body) + JSON.stringify((await call(null, "GET", `/verify/${mandateRow.verificationCode}`)).body);
  for (const secret of ["private/", "memory://", extRow.pdfStorageKey!, mandateRow.pdfDocument!.storageKey, "123456783", "Οδός Δοκιμής", "6977000000", "url", extId, m1]) {
    assert.ok(!publicText.includes(secret), `the public verification response must not contain ${secret.slice(0, 12)}…`);
  }
  assert.equal((await call(null, "GET", `/verify/${extRow.verificationCode}/pdf`)).status, 404, "no document sub-route on the public endpoint");
  assert.deepEqual((await call(null, "GET", `/verify/${extRow.verificationCode}?download=1&format=pdf`)).body, verify.body, "query parameters cannot widen the response");

  // E-signature through a provider (fake adapter).
  let envelopeStatus: "SENT" | "VIEWED" | "SIGNED" = "SENT";
  let sentPdf: Buffer | null = null;
  setSignatureProvider({
    name: "fake",
    async createSigningRequest(req) {
      sentPdf = req.pdf;
      return { envelopeId: `env-${run}`, signingUrls: [{ signer: 0, url: "https://sign.example/x" }] };
    },
    async getEnvelopeStatus() {
      return envelopeStatus;
    },
    async downloadSigned() {
      return Buffer.from("%PDF-1.7 signed by provider");
    },
    getStatus: () => ({ state: "configured", provider: "fake" }),
    async handleWebhook(payload) {
      const p = payload as { secret?: string; envelope?: string; status?: string };
      if (p.secret !== "ok") return { handled: false };
      return { handled: true, envelopeId: p.envelope, status: p.status };
    },
  });
  assert.equal((await call(agentCookie, "PATCH", `/mandates/${m2}`, { startsAt: "2027-11-01", endsAt: "2028-04-30" })).status, 200);
  assert.equal((await call(managerCookie, "POST", `/mandates/${m2}/issue`, {})).status, 200, "no overlap after the dates change");
  let send = await call(managerCookie, "POST", `/mandates/${m2}/send`, {});
  assert.equal(send.status, 409);
  assert.match(send.body.error.message, /Πάροχος υπογραφής|επίπεδο υπογραφής/);
  assert.equal((await call(adminCookie, "PUT", "/settings/sections/mandates", { values: { numberingPrefix: `T${RUN.slice(0, 4)}`, numberingDigits: 5, retentionYears: 10, signatureProvider: "fake", signatureLevel: "ADVANCED", signingExpiryDays: 14 } })).status, 200);
  send = await call(managerCookie, "POST", `/mandates/${m2}/send`, {});
  assert.equal(send.status, 200, JSON.stringify(send.body));
  const m2row = await db().mandate.findUniqueOrThrow({ where: { id: m2 } });
  assert.equal(createHash("sha256").update(sentPdf!).digest("hex"), m2row.pdfChecksum, "the provider received exactly the issued PDF");

  assert.equal((await call(null, "POST", "/webhooks/signature", { secret: "wrong", envelope: `env-${run}`, status: "SIGNED" })).status, 404, "unverified webhook ignored");
  assert.equal((await call(null, "POST", "/webhooks/signature", { secret: "ok", envelope: `env-${run}`, status: "VIEWED" })).status, 200);
  assert.equal((await db().mandate.findUniqueOrThrow({ where: { id: m2 } })).status, "VIEWED");
  envelopeStatus = "SIGNED";
  assert.equal((await call(managerCookie, "POST", `/mandates/${m2}/refresh`, {})).body.changed, true);
  const m2signed = await db().mandate.findUniqueOrThrow({ where: { id: m2 }, include: { signedDocument: true, parties: true } });
  assert.equal(m2signed.status, "SIGNED");
  assert.equal(m2signed.signatureMethod, "PROVIDER");
  assert.ok(m2signed.signedDocument && m2signed.parties.every((p) => p.signedAt));
  assert.equal((await call(null, "POST", "/webhooks/signature", { secret: "ok", envelope: `env-${run}`, status: "DECLINED" })).status, 200);
  assert.equal((await db().mandate.findUniqueOrThrow({ where: { id: m2 } })).status, "SIGNED", "a late webhook cannot undo a signature");
  setSignatureProvider(null);

  // Viewing mandate: draft, cancel, duplicate.
  const v = await call(agentCookie, "POST", "/mandates", { type: "VIEWING", propertyReference: property.reference, terms: { viewingDate: "2026-11-05" }, parties: [{ fullName: "Πελάτης Δοκιμής" }] });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal((await call(managerCookie, "POST", `/mandates/${v.body.mandate.id}/cancel`, {})).status, 422, "cancel needs a reason");
  assert.equal((await call(managerCookie, "POST", `/mandates/${v.body.mandate.id}/cancel`, { reason: "Ο πελάτης δεν ήρθε" })).status, 200);
  const dup = await call(agentCookie, "POST", `/mandates/${v.body.mandate.id}/duplicate`, {});
  assert.equal(dup.status, 200);
  assert.equal((await db().mandate.findUniqueOrThrow({ where: { id: dup.body.mandate.id } })).status, "DRAFT");

  // Plain document upload with a checklist item.
  const trx = await call(agentCookie, "POST", "/transactions", { propertyReference: property.reference, buyerName: "Αγοραστής" });
  const tid = trx.body.transaction.id as string;
  await call(agentCookie, "POST", `/transactions/${tid}/checklist`, { label: "Ενεργειακό πιστοποιητικό" });
  const item = await db().transactionChecklistItem.findFirstOrThrow({ where: { transactionId: tid } });
  const certToken = await upload(agentCookie, Buffer.concat([Buffer.from("%PDF-1.5\n"), randomBytes(32)]), "application/pdf");
  const doc = await call(agentCookie, "POST", "/documents", { token: certToken, title: "ΠΕΑ", category: "INSPECTION", transactionId: tid, checklistItemId: item.id });
  assert.equal(doc.status, 200, JSON.stringify(doc.body));
  assert.equal((await db().transactionChecklistItem.findUniqueOrThrow({ where: { id: item.id } })).status, "RECEIVED");
  assert.equal((await call(otherCookie, "POST", "/documents", { token: certToken, title: "x" })).status, 403, "token is bound to its uploader");
  assert.equal((await call(agentCookie, "DELETE", `/documents/${doc.body.document.id}`)).status, 403, "delete is manager-only");
  assert.equal((await call(managerCookie, "DELETE", `/documents/${doc.body.document.id}`)).status, 200);

  // Timelines and audit.
  const events = await db().mandateEvent.findMany({ where: { mandateId: m1 } });
  for (const t of ["CREATED", "ISSUED", "SIGNED"]) assert.ok(events.some((e) => e.type === t), `mandate timeline has ${t}`);
  await assert.rejects(db().mandateEvent.update({ where: { id: events[0]!.id }, data: { summary: "x" } }));
  const sellerEvents = await db().sellerLeadEvent.findMany({ where: { sellerLeadId: sellerId } });
  assert.ok(sellerEvents.some((e) => e.type === "MANDATE_SIGNED"));
  const downloads = await db().auditLog.count({ where: { entity: "DOCUMENT", entityId: row.pdfDocumentId!, action: "download" } });
  assert.equal(downloads, 1, "downloads are audited");

  setDocumentStore(null);
  await db().$disconnect();
});
