/**
 * Phase B end to end through the real API: a showing from draft to issued,
 * downloaded, signed on paper and replaced; permissions, privacy, the audit
 * trail and public verification. Runs only with TEST_DATABASE_URL set.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("showings: draft → validate → issue → PDF → paper signature → replacement, with permissions, privacy and audit", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { memoryDocumentStore, setDocumentStore } = await import("../lib/document-store");
  const { installAllTemplates } = await import("../lib/brokerage/documents/test-support");
  const { setSignatureProvider } = await import("../providers/signature");

  const store = memoryDocumentStore();
  setDocumentStore(store);
  setSignatureProvider(null);
  const legal = { legalNameEl: "HOME88 Μεσιτική", legalNameEn: "HOME88 Real Estate", vatNumber: "123456783", taxOffice: "ΔΟΥ Δοκιμής", registeredAddressEl: "Οδός 1, Αθήνα", registeredAddressEn: "1 Street, Athens", phone: "2100000000" };
  await db().companyLegalDetails.upsert({ where: { id: "default" }, create: { id: "default", ...legal }, update: legal });
  await db().commissionSettings.upsert({ where: { id: "default" }, create: { id: "default", vatRatePct: 24 }, update: { vatRatePct: 24 } });
  await installAllTemplates(db());

  const run = randomBytes(4).toString("hex");
  const RUN = run.toUpperCase();
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) => db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
  const [agent, other, manager, viewer] = await Promise.all([mk("AGENT", "sagent"), mk("AGENT", "sagent2"), mk("MANAGER", "smanager"), mk("VIEWER", "sviewer")]);
  const login = async (email: string) => {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  };
  const [agentC, otherC, managerC, viewerC] = await Promise.all([login(agent.email), login(other.email), login(manager.email), login(viewer.email)]);
  const call = async (cookie: string | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  };
  const upload = async (cookie: string, bytes: Buffer) => {
    const r = await call(cookie, "POST", "/documents/uploads", { fileName: "f", mimeType: "application/pdf", byteSize: bytes.length });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await store.put(String(r.body.upload.url).replace("memory://", ""), bytes, "application/pdf");
    return r.body.token as string;
  };

  const ref = `SHW-P${RUN}`;
  await db().property.create({ data: { reference: ref, slug: `shw-${run}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Δοκιμή", descriptionEl: "Φωτεινό διαμέρισμα", city: "Αθήνα", areaName: "Κουκάκι", address: "Αλαμάνας 1, Μαρούσι", price: 250000, area: 90, status: "ACTIVE", agentId: agent.id } });
  const payload = {
    language: "el", propertyReferences: [ref],
    parties: [{ role: "BUYER", fullName: "Γιώργος Κωνσταντίνου", taxId: "123456783", taxOffice: "ΔΟΥ Α΄", idNumber: "ΑΒ123456", address: "Οδός Πελάτη 1, Αθήνα", phone: "6900000000", email: "g@test.invalid", identityVerified: true, isSignatory: true }],
    feePayer: "OWNER", feeMethod: "PERCENTAGE", feeBasis: "ASKING_PRICE", feePercentage: 2, feeCurrency: "EUR", vatTreatment: "PLUS_VAT", vatRate: 24,
  };

  // Not signed in / no permission.
  assert.equal((await call(null, "GET", "/showings")).status, 401);
  assert.equal((await call(viewerC, "GET", "/showings")).status, 403, "a viewer has no showings permission");
  assert.equal((await call(viewerC, "POST", "/showings", payload)).status, 403);

  // An agent prepares the draft.
  const created = await call(agentC, "POST", "/showings", payload);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = created.body.showing.id as string;
  assert.equal(created.body.showing.status, "DRAFT");
  assert.equal((await call(otherC, "GET", `/showings/${id}`)).status, 404, "another agent cannot see it");
  assert.equal((await call(managerC, "GET", `/showings/${id}`)).status, 200);
  const stored = await db().showingParty.findFirstOrThrow({ where: { showingId: id } });
  assert.ok(stored.taxIdEncrypted?.startsWith("v1:") && !JSON.stringify(stored).includes("123456783"), "identity encrypted at rest");

  // Impossible fee values are refused even in a draft.
  assert.equal((await call(agentC, "PATCH", `/showings/${id}`, { feePercentage: 120 })).status, 422);

  // Validate: the shared validators; issuance-blocking issues are reported without issuing.
  const validated = await call(agentC, "POST", `/showings/${id}/validate`, {});
  assert.equal(validated.status, 200);
  assert.equal(validated.body.issuable, true, JSON.stringify(validated.body.issuanceBlockingIssues));

  // Agents prepare; managers issue.
  assert.equal((await call(agentC, "POST", `/showings/${id}/issue`, {})).status, 403);
  assert.equal((await call(agentC, "POST", `/showings/${id}/send`, {})).status, 403);
  assert.equal((await call(agentC, "POST", `/showings/${id}/cancel`, { reason: "x" })).status, 403);
  assert.equal((await call(agentC, "GET", `/showings/${id}/pdf`)).status, 409, "no PDF before issue");

  const issued = await call(managerC, "POST", `/showings/${id}/issue`, {});
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.match(issued.body.number, /^ΥΠ-\d{4}-\d{6}$/);
  assert.equal(issued.body.storageState, "CONFIRMED");
  const again = await call(managerC, "POST", `/showings/${id}/issue`, {});
  assert.equal(again.status, 200); assert.equal(again.body.number, issued.body.number); assert.equal(again.body.alreadyIssued, true, "repeating the request is safe");

  // Frozen: API and database.
  assert.equal((await call(agentC, "PATCH", `/showings/${id}`, { comments: "x" })).status, 409);
  await assert.rejects(db().showing.update({ where: { id }, data: { comments: "x" } }));

  // PDF access: permission and visibility, short-lived signed URL, audited; never a bucket key to the client.
  assert.equal((await call(viewerC, "GET", `/showings/${id}/pdf`)).status, 403);
  assert.equal((await call(otherC, "GET", `/showings/${id}/pdf`)).status, 404);
  const pdf = await call(agentC, "GET", `/showings/${id}/pdf`);
  assert.equal(pdf.status, 200, JSON.stringify(pdf.body));
  assert.equal(pdf.body.expiresInSeconds, 120);
  const row = await db().showing.findUniqueOrThrow({ where: { id } });
  assert.equal(pdf.body.checksum, row.pdfChecksum);
  assert.ok(pdf.body.filename.endsWith(".pdf") && !pdf.body.filename.includes("/"));
  assert.equal(createHash("sha256").update(store.objects.get(row.pdfStorageKey!)!.body).digest("hex"), row.pdfChecksum);

  // Privacy: identity is shown to those who hold showings.view_sensitive_data and masked to those who do not.
  const detail = await call(agentC, "GET", `/showings/${id}`);
  assert.equal(detail.body.showing.parties[0].taxId, "123456783");
  const superUser = await mk("SUPER_ADMIN", "ssuper");
  const superC = await login(superUser.email);
  assert.equal((await call(superC, "PUT", "/settings/permissions", { role: "AGENT", permission: "showings.view_sensitive_data", granted: false })).status, 200);
  try {
    const masked = await call(agentC, "GET", `/showings/${id}`);
    assert.equal(masked.status, 200);
    assert.ok(!JSON.stringify(masked.body).includes("123456783") && !JSON.stringify(masked.body).includes("6900000000"), "identity is masked without the permission");
    assert.equal(masked.body.showing.parties[0].fullName, "Γιώργος Κωνσταντίνου", "the name itself stays visible");
  } finally {
    assert.equal((await call(superC, "PUT", "/settings/permissions", { role: "AGENT", permission: "showings.view_sensitive_data", granted: true })).status, 200);
  }

  // Public verification: only what tells a genuine document from a forged one.
  const code = row.verificationCode!;
  const verified = await call(null, "GET", `/verify/${code}`);
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.document.number, row.number);
  assert.equal(verified.body.document.type, "SHOWING");
  const dump = JSON.stringify(verified.body);
  for (const secret of ["Κωνσταντίνου", "123456783", "Αλαμάνας", "6900000000"]) assert.ok(!dump.includes(secret), `${secret} must not be public`);
  assert.equal((await call(null, "GET", "/verify/NOTACODE")).status, 404);
  assert.equal((await call(null, "GET", `/verify/${"0".repeat(12)}`)).status, 404);

  // Sending: no provider configured → paper path; a wrong file is refused; the right one signs and the original stays.
  const send = await call(managerC, "POST", `/showings/${id}/send`, {});
  assert.equal(send.status, 409, "no e-signature provider");
  const original = Buffer.from(store.objects.get(row.pdfStorageKey!)!.body);
  const scan = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(64)]);
  const token = await upload(managerC, scan);
  assert.equal((await call(agentC, "POST", `/showings/${id}/signed-copy`, { token })).status, 403, "agents cannot record signatures");
  const signed = await call(managerC, "POST", `/showings/${id}/signed-copy`, { token, signedAt: new Date().toISOString().slice(0, 10) });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  const after = await db().showing.findUniqueOrThrow({ where: { id } });
  assert.equal(after.status, "SIGNED"); assert.equal(after.signatureMethod, "PAPER"); assert.equal(after.signatureLevel, "SIMPLE");
  assert.equal(after.signedPdfChecksum, createHash("sha256").update(scan).digest("hex"));
  assert.equal(after.pdfChecksum, row.pdfChecksum);
  assert.ok(original.equals(store.objects.get(row.pdfStorageKey!)!.body), "the original PDF is untouched");
  assert.equal((await call(managerC, "POST", `/showings/${id}/cancel`, { reason: "x" })).status, 409, "a signed document cannot be cancelled");

  // Replacement: a new draft linked to the original; issuing it keeps the signed original as history.
  assert.equal((await call(agentC, "POST", `/showings/${id}/replace`, { reason: "x" })).status, 403);
  assert.equal((await call(managerC, "POST", `/showings/${id}/replace`, {})).status, 422, "a reason is required");
  const replaced = await call(managerC, "POST", `/showings/${id}/replace`, { reason: "Διόρθωση στοιχείων πελάτη" });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  const newId = replaced.body.showing.id as string;
  assert.equal(replaced.body.showing.replaces, id);
  assert.equal((await call(managerC, "POST", `/showings/${id}/replace`, { reason: "again" })).status, 409, "replaced once only");
  const reissued = await call(managerC, "POST", `/showings/${newId}/issue`, {});
  assert.equal(reissued.status, 200, JSON.stringify(reissued.body));
  assert.notEqual(reissued.body.number, issued.body.number);
  assert.equal((await db().showing.findUniqueOrThrow({ where: { id } })).status, "SIGNED", "a signed original is kept as signed history");

  // A draft can be cancelled by a manager, with a reason.
  const draft = (await call(agentC, "POST", "/showings", payload)).body.showing.id as string;
  assert.equal((await call(managerC, "POST", `/showings/${draft}/cancel`, {})).status, 422);
  assert.equal((await call(managerC, "POST", `/showings/${draft}/cancel`, { reason: "Ο πελάτης αποσύρθηκε" })).status, 200);
  assert.equal((await call(managerC, "POST", `/showings/${draft}/issue`, {})).status, 409, "a cancelled showing is never issued");

  // A blocked issue explains itself and leaves a draft.
  const bad = (await call(agentC, "POST", "/showings", { ...payload, parties: [] })).body.showing.id as string;
  const blocked = await call(managerC, "POST", `/showings/${bad}/issue`, {});
  assert.equal(blocked.status, 422); assert.equal(blocked.body.error.code, "document_blocked"); assert.ok(blocked.body.error.fields);
  const badRow = await db().showing.findUniqueOrThrow({ where: { id: bad } });
  assert.equal(badRow.number, null); assert.equal(badRow.pdfStorageKey, null);

  // The trail: events and the audit log, with who did what and without personal data.
  const events = await call(managerC, "GET", `/showings/${id}/events`);
  assert.equal(events.status, 200);
  const types = events.body.audit.map((a: any) => a.type);
  for (const t of ["SHOWING_CREATED", "SHOWING_VALIDATED", "SHOWING_ISSUED", "SHOWING_PDF_GENERATED", "SHOWING_PDF_DOWNLOADED", "SHOWING_SIGNED", "SHOWING_REPLACED"]) assert.ok(types.includes(t), `${t} in ${types}`);
  const trail = JSON.stringify(events.body);
  for (const secret of ["123456783", "ΑΒ123456", "Οδός Πελάτη 1", "6900000000", "g@test.invalid"]) assert.ok(!trail.includes(secret), `${secret} must not be in the trail`);
  const dl = events.body.audit.find((a: any) => a.type === "SHOWING_PDF_DOWNLOADED");
  assert.equal(dl.actorUserId, agent.id); assert.equal(dl.actorRole, "AGENT");
  const list = await call(agentC, "GET", "/showings");
  assert.ok(list.body.data.some((s: any) => s.id === id));
  assert.ok(!(await call(otherC, "GET", "/showings")).body.data.some((s: any) => s.id === id), "another agent's list does not include it");

  setDocumentStore(null);
  await db().$disconnect();
});
