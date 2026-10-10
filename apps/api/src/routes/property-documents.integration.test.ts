/**
 * Property document checklist and passport. Real API and Postgres; runs only
 * with TEST_DATABASE_URL set (and the 20261022000000 migration applied).
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("property documents: checklist rules, review rights, passport scope", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");

  const run = randomBytes(4).toString("hex");
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) => db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
  const [owner, other, manager, viewer] = await Promise.all([mk("AGENT", "docagent"), mk("AGENT", "docagent2"), mk("MANAGER", "docmanager"), mk("VIEWER", "docviewer")]);
  const login = async (email: string) => {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  };
  const [ownerC, otherC, managerC, viewerC] = await Promise.all([login(owner.email), login(other.email), login(manager.email), login(viewer.email)]);
  const call = async (cookie: string, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) };
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  };

  const mkProperty = (tag: string, propertyType: string, listingType: string, agentId: string) => db().property.create({
    data: { reference: `H88-T${tag}-${run}`, slug: `t-${tag}-${run}`, listingType: listingType as never, propertyType: propertyType as never, titleEl: `Δοκιμή ${tag}`, descriptionEl: "Περιγραφή", agentId, createdById: agentId, price: 200000, area: 80, areaName: "Γλυφάδα" },
  });
  const flat = await mkProperty("A", "APARTMENT", "SALE", owner.id);
  const plot = await mkProperty("B", "PLOT", "SALE", owner.id);
  const rental = await mkProperty("C", "STUDIO", "RENT", owner.id);
  const base = `/properties/${flat.id}/document-checklist`;

  // === Suggestions depend on the property ======================================
  let r = await call(ownerC, "GET", base);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items, []);
  const usual = (b: any) => b.suggested.filter((s: any) => s.level === "usual").map((s: any) => s.kind).sort();
  assert.deepEqual(usual(r.body), ["BUILDING_PERMIT", "CADASTRE", "ENERGY_CERT", "ENGINEER_CERT", "MANDATE", "TAX", "TITLE_DEED"]);
  assert.ok(!usual((await call(ownerC, "GET", `/properties/${plot.id}/document-checklist`)).body).includes("ENERGY_CERT"), "no energy certificate for a plot");
  assert.ok(usual((await call(ownerC, "GET", `/properties/${plot.id}/document-checklist`)).body).includes("TOPOGRAPHIC"));
  assert.deepEqual(usual((await call(ownerC, "GET", `/properties/${rental.id}/document-checklist`)).body), ["ENERGY_CERT", "MANDATE"]);
  assert.equal(r.body.canEdit, true);
  assert.equal(r.body.canReview, false);

  // === Adding: the suggested set, twice is harmless =============================
  r = await call(ownerC, "POST", `${base}/suggested`, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 7);
  r = await call(ownerC, "POST", `${base}/suggested`, {});
  assert.equal(r.body.items.length, 7, "applying the suggestion again adds nothing");
  r = await call(ownerC, "POST", base, { kind: "TITLE_DEED" });
  assert.equal(r.body.items.filter((i: any) => i.kind === "TITLE_DEED").length, 1, "a standard kind is listed once");
  r = await call(ownerC, "POST", base, { kind: "OTHER", label: "Βεβαίωση ΔΕΗ" });
  assert.equal(r.status, 201);
  assert.ok(r.body.items.some((i: any) => i.label === "Βεβαίωση ΔΕΗ"));
  assert.equal((await call(ownerC, "POST", base, { kind: "PASSPORT" })).status, 422);

  // === Who may change what =======================================================
  const energy = r.body.items.find((i: any) => i.kind === "ENERGY_CERT");
  assert.equal((await call(otherC, "PATCH", `${base}/${energy.id}`, { status: "REQUESTED" })).status, 403, "another agent's property");
  assert.equal((await call(viewerC, "GET", base)).status, 403, "a viewer has no access");
  r = await call(ownerC, "PATCH", `${base}/${energy.id}`, { status: "REQUESTED", note: "Ζητήθηκε από τον μηχανικό" });
  assert.equal(r.status, 200);
  const requested = r.body.items.find((i: any) => i.id === energy.id);
  assert.equal(requested.status, "REQUESTED");
  assert.ok(requested.requestedAt);
  assert.equal((await call(ownerC, "PATCH", `${base}/${energy.id}`, { status: "UPLOADED" })).status, 422, "no document, no 'uploaded'");

  // A document of this property can answer the item; one of another property cannot.
  const doc = await db().document.create({ data: { propertyId: flat.id, title: "ΠΕΑ", category: "INSPECTION", storageKey: `documents/test/${run}-a.pdf`, mimeType: "application/pdf", byteSize: 100, uploadedById: owner.id } });
  const foreign = await db().document.create({ data: { propertyId: plot.id, title: "Άλλο", category: "OTHER", storageKey: `documents/test/${run}-b.pdf`, mimeType: "application/pdf", byteSize: 100, uploadedById: owner.id } });
  assert.equal((await call(ownerC, "PATCH", `${base}/${energy.id}`, { documentId: foreign.id })).status, 422);
  r = await call(ownerC, "PATCH", `${base}/${energy.id}`, { documentId: doc.id });
  const linked = r.body.items.find((i: any) => i.id === energy.id);
  assert.equal(linked.status, "UPLOADED", "linking a document moves a waiting item to 'uploaded'");
  assert.equal(linked.document.id, doc.id);

  // Review is a manager's: never the listing agent's own.
  assert.equal((await call(ownerC, "PATCH", `${base}/${energy.id}`, { status: "VERIFIED" })).status, 403);
  r = await call(managerC, "PATCH", `${base}/${energy.id}`, { status: "VERIFIED" });
  assert.equal(r.status, 200);
  const verified = r.body.items.find((i: any) => i.id === energy.id);
  assert.equal(verified.status, "VERIFIED");
  assert.equal(verified.reviewedBy, "docmanager Test");
  assert.ok(verified.reviewedAt);
  assert.equal((await call(ownerC, "PATCH", `${base}/${energy.id}`, { status: "PENDING" })).status, 403, "a reviewed item changes only by a manager");
  assert.equal((await call(ownerC, "DELETE", `${base}/${energy.id}`)).status, 403);
  const tax = r.body.items.find((i: any) => i.kind === "TAX");
  r = await call(ownerC, "PATCH", `${base}/${tax.id}`, { status: "NOT_REQUIRED" });
  assert.equal(r.body.items.find((i: any) => i.id === tax.id).status, "NOT_REQUIRED");
  r = await call(ownerC, "GET", base);
  assert.deepEqual(r.body.summary, { total: 8, required: 7, done: 1, verified: 1, waiting: 6, problems: 0 });
  const audit = await db().auditLog.findMany({ where: { entity: "PROPERTY", entityId: flat.id, action: { startsWith: "document_item" } } });
  assert.ok(audit.some((a) => a.action === "document_item_update" && (a.changes as any).status?.to === "VERIFIED"), "the review is in the audit log");

  // === Passport: one summary, scoped like the lists it links to ===================
  const contact = await db().contact.create({ data: { reference: `C-TD-${run}`, firstName: "Ελένη", lastName: "Ιδιοκτήτρια", roles: ["SELLER"] as never, status: "ACTIVE" as never } });
  await db().propertyOwner.create({ data: { propertyId: flat.id, contactId: contact.id, capacity: "OWNER", isPrimaryContact: true } });
  await db().viewing.create({ data: { propertyId: flat.id, clientName: "Πελάτης Α", startsAt: new Date(Date.now() + 86_400_000), agentId: other.id } });
  await db().viewing.create({ data: { propertyId: flat.id, clientName: "Πελάτης Β", startsAt: new Date(Date.now() + 2 * 86_400_000), agentId: owner.id } });
  await db().propertyIntakeSession.create({ data: { userId: owner.id, status: "CREATED", propertyId: flat.id, state: { location: { lat: 37.8654321, lng: 23.7543219, accuracy: 8, source: "gps", visibility: "approximate", capturedAt: new Date().toISOString() } } as never } });

  r = await call(ownerC, "GET", `/properties/${flat.id}/passport`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.owners.map((o: any) => [o.name, o.reference, o.capacity]), [["Ελένη Ιδιοκτήτρια", contact.reference, "OWNER"]]);
  assert.ok(!JSON.stringify(r.body.owners).match(/@|phone|email/i), "owners by name and reference only");
  assert.equal(r.body.viewings.count, 1, "an agent counts only their own viewings");
  assert.equal(r.body.checklist.available, true);
  assert.equal(r.body.checklist.summary.verified, 1);
  assert.equal(r.body.intake.location.lat, 37.8654321, "the agent who recorded it sees the exact point");
  assert.ok(typeof r.body.completeness.percent === "number");
  assert.ok(r.body.activity.some((a: any) => a.action === "document_item_update"));
  r = await call(managerC, "GET", `/properties/${flat.id}/passport`);
  assert.equal(r.body.viewings.count, 2, "a manager sees the whole office");
  r = await call(otherC, "GET", `/properties/${flat.id}/passport`);
  assert.equal(r.body.intake.location, null, "another agent does not see the exact point");
  assert.equal(r.body.viewings.count, 1);
  assert.equal((await call(viewerC, "GET", `/properties/${flat.id}/passport`)).status, 403);

  // === Without the migration the checklist says so instead of failing ==============
  // Simulated inside a transaction that is always rolled back: the table is renamed away, queried, and restored.
  const { isMissingTable } = await import("./property-documents");
  let seen: unknown = null;
  await db().$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE "property_document_items" RENAME TO "property_document_items_off"`);
    seen = await tx.propertyDocumentItem.findMany({ where: { propertyId: flat.id } }).catch((x: unknown) => x);
    throw new Error("rollback");
  }).catch((e: Error) => assert.equal(e.message, "rollback"));
  assert.ok(isMissingTable(seen), "a missing table is recognised");
  assert.equal((await call(ownerC, "GET", base)).status, 200, "the table is back after the rollback");
});
