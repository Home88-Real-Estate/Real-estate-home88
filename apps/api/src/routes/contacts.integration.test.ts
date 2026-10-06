/**
 * The contact workspace through the real API and a real Postgres: filtered
 * list, create with duplicate review, CSV export (permissions, sensitive
 * data, injection), bulk actions (permissions, audit), the tab endpoints and
 * the workflow contact → showing with several properties → history.
 * Runs only when TEST_DATABASE_URL points at a disposable database:
 *
 *   TEST_DATABASE_URL=postgresql://… npx tsx --test src/routes/contacts.integration.test.ts
 *
 * Other test files share the database, so assertions are about records this test created.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("contacts: list, export, bulk, tabs and showing workflow", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { resetConfig } = await import("../config");
  const { installApprovedTemplate } = await import("../lib/brokerage/documents/test-support");
  resetConfig();

  const run = randomBytes(4).toString("hex");
  const RUN = run.toUpperCase();
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) => db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
  const [agent, manager, admin] = await Promise.all([mk("AGENT", "cwagent"), mk("MANAGER", "cwmanager"), mk("ADMIN", "cwadmin")]);
  async function login(email: string) {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }
  const [agentCookie, managerCookie, adminCookie] = await Promise.all([login(agent.email), login(manager.email), login(admin.email)]);
  const raw = (cookie: string | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    return handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  };
  const call = async (cookie: string | null, method: string, path: string, body?: unknown) => {
    const res = await raw(cookie, method, path, body);
    return { status: res.status, body: (await res.json()) as any };
  };

  // ---- Create, with duplicate review --------------------------------------
  const email = `maria-${run}@test.invalid`;
  const mobile = `+3069${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  let r = await call(agentCookie, "POST", "/contacts", { firstName: `Μαρία${RUN}`, lastName: "Παπαδοπούλου", email, mobile, city: "Αθήνα", postalCode: "11524", taxId: "123456789", address: "Σταδίου 1", roles: ["BUYER"] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const maria = r.body.contact;
  const stored = await db().contact.findUniqueOrThrow({ where: { id: maria.id } });
  assert.equal(stored.assignedToId, agent.id, "a new contact is looked after by its creator");
  assert.ok(stored.lastActivityAt, "last activity is recorded");
  assert.ok(!JSON.stringify(stored).includes(email) && !JSON.stringify(stored).includes("123456789"), "personal data is stored encrypted");

  r = await call(agentCookie, "POST", "/contacts", { firstName: "Άλλη", lastName: "Μαρία", email });
  assert.equal(r.status, 409, "same email: a possible duplicate, never merged automatically");
  assert.equal(r.body.error.code, "potential_duplicate");
  assert.equal(r.body.error.duplicates[0].id, maria.id);
  r = await call(agentCookie, "POST", "/contacts", { firstName: "Άλλη", lastName: `Μαρία${RUN}`, email, confirmDuplicate: true });
  assert.equal(r.status, 201, "a person reviewed it and confirmed");
  const twin = r.body.contact;
  r = await call(agentCookie, "POST", "/contacts", { firstName: "", lastName: "", email: "not-an-email" });
  assert.equal(r.status, 422);

  const tom = (await call(managerCookie, "POST", "/contacts", { firstName: `Τομ${RUN}`, lastName: "Άσχετος", roles: ["SELLER"], assignedToId: manager.id, status: "INACTIVE" })).body.contact;
  assert.equal((await call(agentCookie, "POST", "/contacts", { firstName: "Χ", assignedToId: manager.id })).status, 403, "agents do not assign contacts to others");

  // ---- Filters read the real table ----------------------------------------
  const ids = async (qs: string) => ((await call(agentCookie, "GET", `/contacts?${qs}&limit=100`)).body.data as any[]).map((c) => c.id);
  assert.deepEqual((await ids(`q=${encodeURIComponent(`Μαρία${RUN}`)}`)).sort(), [maria.id, twin.id].sort(), "name search");
  assert.deepEqual(await ids(`q=${encodeURIComponent(`Μαρία${RUN} Παπαδ`)}`), [maria.id], "first and last name words");
  assert.deepEqual((await ids(`email=${encodeURIComponent(email)}`)).sort(), [maria.id, twin.id].sort(), "exact email through its hash");
  assert.deepEqual(await ids(`phone=${encodeURIComponent(mobile)}`), [maria.id], "phone through its hash");
  assert.deepEqual(await ids(`assignedToId=${manager.id}`), [tom.id]);
  assert.ok((await ids("assignedToId=none")).every((id) => id !== maria.id));
  assert.deepEqual(await ids(`status=INACTIVE&q=${RUN}`), [tom.id]);
  assert.deepEqual(await ids(`role=SELLER&q=${RUN}`), [tom.id]);
  assert.deepEqual((await ids(`createdFrom=2000-01-01&createdTo=2000-01-02&q=${RUN}`)), []);
  assert.equal((await ids(`activeFrom=${new Date().toISOString().slice(0, 10)}&q=${RUN}`)).length, 3, "all three were active today");
  await db().contact.update({ where: { id: twin.id }, data: { lastActivityAt: new Date(Date.now() - 100 * 86_400_000) } });
  assert.deepEqual(await ids(`inactiveDays=30&q=${RUN}`), [twin.id], "nothing recorded for 30+ days");
  r = await call(agentCookie, "GET", `/contacts?q=${encodeURIComponent(`Μαρία${RUN}`)}&sort=lastName&dir=asc`);
  assert.equal(r.body.data[0].assignedTo?.name ?? null, r.body.data[0].assignedTo ? `${agent.firstName} ${agent.lastName}` : null);
  assert.equal(r.body.pagination.total, 2);
  assert.ok(r.body.data.every((c: any) => !("emailEncrypted" in c)), "ciphertext never leaves the API");
  assert.equal((await call(agentCookie, "GET", "/contacts?page=0")).status, 422);

  // ---- Export ---------------------------------------------------------------
  assert.equal((await raw(null, "GET", "/contacts/export")).status, 401);
  assert.equal((await raw(agentCookie, "GET", "/contacts/export")).status, 403, "agents cannot export by default");
  await db().contact.update({ where: { id: tom.id }, data: { firstName: `=HYPERLINK("http://x")${RUN}` } });
  const exp = await raw(managerCookie, "GET", `/contacts/export?q=${RUN}`);
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get("content-disposition") ?? "", /attachment; filename="home88-contacts-\d{4}-\d{2}-\d{2}\.csv"/);
  const bytes = Buffer.from(await exp.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = bytes.subarray(3).toString("utf8");
  assert.ok(csv.startsWith("Κωδικός;Όνομα;Επώνυμο;Εταιρεία;Σχέση;Τηλέφωνο;Email;Διαχειριστής;Τελευταία δραστηριότητα;Ημερομηνία καταχώρησης;Κατάσταση"), csv.split("\r\n")[0]);
  assert.ok(csv.includes(maria.reference) && csv.includes(email), "filtered rows with contact details");
  assert.ok(!csv.includes("123456789") && !csv.includes("Σταδίου 1"), "identity data is not in a normal export");
  assert.ok(csv.includes(`"'=HYPERLINK`), "formulas are neutralised");
  assert.equal((await raw(managerCookie, "GET", `/contacts/export?q=${RUN}&sensitive=1`)).status, 403, "sensitive export is a separate permission");
  const sens = await raw(adminCookie, "GET", `/contacts/export?q=${RUN}&sensitive=1`);
  assert.equal(sens.status, 200);
  assert.ok((await sens.text()).includes("123456789"), "with the permission and an explicit choice");
  const narrow = await (await raw(managerCookie, "GET", `/contacts/export?q=${RUN}&status=INACTIVE`)).text();
  assert.ok(narrow.includes(tom.reference) && !narrow.includes(maria.reference), "the export follows the active filters");
  const audits = await db().auditLog.findMany({ where: { entity: "CONTACT", entityId: "export", actorId: { in: [manager.id, admin.id] } }, orderBy: { createdAt: "asc" } });
  assert.ok(audits.some((a) => a.action === "export") && audits.some((a) => a.action === "export:sensitive"), "exports are audited");
  assert.ok(!JSON.stringify(audits).includes(email) && !JSON.stringify(audits).includes("123456789"), "the audit holds the filter and count, never the data");

  // ---- Bulk ----------------------------------------------------------------
  assert.equal((await call(agentCookie, "POST", "/contacts/bulk", { ids: [maria.id], action: "assign", assignedToId: manager.id })).status, 403);
  assert.equal((await call(agentCookie, "POST", "/contacts/bulk", { ids: [maria.id], action: "status", status: "INACTIVE" })).status, 403);
  r = await call(managerCookie, "POST", "/contacts/bulk", { ids: [maria.id, twin.id, "nope"], action: "assign", assignedToId: manager.id });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.updated, r.body.skipped], [2, 1]);
  assert.equal((await db().contact.findUniqueOrThrow({ where: { id: maria.id } })).assignedToId, manager.id);
  assert.equal((await call(managerCookie, "POST", "/contacts/bulk", { ids: [maria.id], action: "assign", assignedToId: "ghost" })).status, 400, "only active users");
  assert.equal((await call(managerCookie, "POST", "/contacts/bulk", { ids: [], action: "status", status: "ACTIVE" })).status, 422);
  r = await call(managerCookie, "POST", "/contacts/bulk", { ids: [twin.id], action: "marketing_opt_out" });
  assert.ok((await db().contact.findUniqueOrThrow({ where: { id: twin.id } })).marketingOptOutAt, "consent change applied");
  await call(managerCookie, "POST", "/contacts/bulk", { ids: [twin.id], action: "marketing_opt_in" });
  assert.equal((await db().contact.findUniqueOrThrow({ where: { id: twin.id } })).marketingOptOutAt, null);
  const bulkAudit = await db().auditLog.count({ where: { entity: "CONTACT", entityId: maria.id, action: "bulk:assign", actorId: manager.id } });
  assert.equal(bulkAudit, 1, "bulk assignment is audited per contact");

  // ---- Detail / update ---------------------------------------------------------
  r = await call(agentCookie, "GET", `/contacts/${maria.id}`);
  assert.equal(r.body.contact.email, email);
  assert.equal(r.body.contact.taxId, "123456789", "agents hold showings.view_sensitive_data by default");
  assert.equal(r.body.contact.city, "Αθήνα");
  r = await call(agentCookie, "PATCH", `/contacts/${maria.id}`, { city: "Πειραιάς", workPhone: "2101234567", roles: ["BUYER", "TENANT"] });
  assert.equal(r.status, 200);
  r = await call(agentCookie, "GET", `/contacts/${maria.id}`);
  assert.deepEqual([r.body.contact.city, r.body.contact.workPhone, r.body.contact.roles], ["Πειραιάς", "2101234567", ["BUYER", "TENANT"]]);
  assert.equal((await call(agentCookie, "PATCH", `/contacts/${maria.id}`, { assignedToId: agent.id })).status, 200, "taking a contact is allowed");
  assert.equal((await call(agentCookie, "PATCH", `/contacts/${maria.id}`, { assignedToId: admin.id })).status, 403);
  assert.equal((await call(agentCookie, "PATCH", "/contacts/nope", { city: "x" })).status, 404);

  // ---- Properties tab -------------------------------------------------------------
  const mkProp = (suffix: string, extra: Record<string, unknown> = {}) =>
    db().property.create({ data: { reference: `CW-${RUN}-${suffix}`, slug: `cw-${run}-${suffix}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: `Διαμέρισμα ${suffix}`, descriptionEl: "Δοκιμή", price: 150000, area: 80, city: "Αθήνα", areaName: "Κολωνάκι", address: `Οδός ${suffix} 5`, status: "ACTIVE", agentId: agent.id, ...extra } });
  const [p1, p2, p3] = await Promise.all([mkProp("A"), mkProp("B"), mkProp("C")]);
  assert.equal((await call(agentCookie, "POST", `/contacts/${maria.id}/properties`, { propertyId: p1.id, relation: "OWNER" })).status, 201);
  assert.equal((await call(agentCookie, "POST", `/contacts/${maria.id}/properties`, { propertyId: p1.id, relation: "OWNER" })).status, 409);
  assert.equal((await call(agentCookie, "POST", `/contacts/${maria.id}/properties`, { propertyId: p2.id, relation: "INTERESTED" })).status, 201);
  assert.equal((await call(agentCookie, "POST", `/contacts/${maria.id}/properties`, { propertyId: p2.id, relation: "INTERESTED" })).status, 409);
  assert.equal((await call(agentCookie, "POST", `/contacts/${maria.id}/properties`, { propertyId: "nope", relation: "BUYER" })).status, 404);
  r = await call(agentCookie, "GET", `/contacts/${maria.id}/properties`);
  const rel = Object.fromEntries(r.body.data.map((x: any) => [x.property.reference, x.relationLabel]));
  assert.deepEqual(rel, { [p1.reference]: "Ιδιοκτήτης", [p2.reference]: "Ενδιαφερόμενος" });
  const interested = r.body.data.find((x: any) => x.relation === "INTERESTED");
  assert.equal((await call(agentCookie, "DELETE", `/contacts/${maria.id}/properties/${interested.linkId}`)).status, 200);
  assert.equal((await call(agentCookie, "GET", `/contacts/${maria.id}/properties`)).body.data.length, 1);

  // ---- Requests / reminders tabs ------------------------------------------------------
  await db().buyerRequest.create({ data: { reference: `RQ-${RUN}`, listingType: "SALE", propertyTypes: ["APARTMENT"], areas: ["Κολωνάκι"], maxPrice: 200000, clientName: "Μαρία", contactId: maria.id, assignedToId: agent.id } });
  r = await call(agentCookie, "GET", `/contacts/${maria.id}/requests`);
  assert.deepEqual(r.body.data.map((x: any) => [x.reference, x.areas, x.maxPrice]), [[`RQ-${RUN}`, ["Κολωνάκι"], 200000]]);
  r = await call(agentCookie, "POST", "/tasks", { title: "Τηλέφωνο στη Μαρία", dueAt: "2030-01-10T10:00", contactId: maria.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await call(agentCookie, "GET", `/contacts/${maria.id}/reminders`);
  assert.deepEqual(r.body.data.map((x: any) => x.title), ["Τηλέφωνο στη Μαρία"], "the existing reminders module, linked to the contact");

  // ---- Showing workflow -------------------------------------------------------------------
  const before = (await db().contact.findUniqueOrThrow({ where: { id: maria.id } })).lastActivityAt!;
  r = await call(agentCookie, "POST", "/showings", { contactReference: maria.reference, parties: [{ contactReference: maria.reference, role: "BUYER" }], propertyReferences: [p1.reference, p2.reference, p3.reference], visitAt: "2030-01-15T11:30", comments: "Ο πελάτης προτιμά ήσυχη περιοχή." });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const showingId = r.body.showing.id;
  assert.ok((await db().contact.findUniqueOrThrow({ where: { id: maria.id } })).lastActivityAt! >= before, "creating a showing is activity");
  const row = await db().showing.findUniqueOrThrow({ where: { id: showingId }, include: { properties: true } });
  assert.equal(row.properties.length, 3, "one showing, many properties");
  assert.equal(row.responsibleUserId, agent.id);
  assert.ok(row.visitAt);
  assert.equal((await call(agentCookie, "POST", "/showings", { contactReference: maria.reference, responsibleUserId: admin.id })).status, 403);

  // global list
  r = await call(agentCookie, "GET", `/showings?q=${encodeURIComponent(`Μαρία${RUN}`)}`);
  const listed = r.body.data.find((x: any) => x.id === showingId);
  assert.ok(listed, "found by client name");
  assert.deepEqual([listed.contact.reference, listed.agent.name, listed.comments, listed.properties.length], [maria.reference, `${agent.firstName} ${agent.lastName}`, "Ο πελάτης προτιμά ήσυχη περιοχή.", 3]);
  assert.ok(new Date(listed.visitAt).toISOString().startsWith("2030-01-15"));
  assert.ok((await call(agentCookie, "GET", `/showings?q=${encodeURIComponent("Οδός B")}`)).body.data.some((x: any) => x.id === showingId), "found by property address");
  assert.ok((await call(agentCookie, "GET", `/showings?contactId=${maria.id}`)).body.data.every((x: any) => x.contact.id === maria.id));
  assert.equal((await call(agentCookie, "GET", "/showings?from=2031-01-01")).body.data.some((x: any) => x.id === showingId), false, "date filter");

  // client's tab + history
  r = await call(agentCookie, "GET", `/contacts/${maria.id}/showings`);
  assert.deepEqual(r.body.data.map((x: any) => [x.id, x.properties.length]), [[showingId, 3]]);
  r = await call(agentCookie, "GET", `/contacts/${maria.id}/timeline`);
  const entry = r.body.data.find((x: any) => x.type === "showing");
  assert.ok(entry && entry.href === `/showings/${showingId}`, "history entry opens the showing");
  assert.ok(r.body.data.some((x: any) => x.type === "reminder") && r.body.data.some((x: any) => x.type === "request") && r.body.data.some((x: any) => x.type === "property"));
  const times = r.body.data.map((x: any) => new Date(x.at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first");

  // a reminder attached to the showing
  r = await call(agentCookie, "POST", "/tasks", { title: "Follow-up υπόδειξης", dueAt: "2030-01-16T09:00", contactId: maria.id, showingId });
  assert.equal(r.status, 201);
  assert.ok((await call(agentCookie, "GET", `/contacts/${maria.id}/reminders`)).body.data.some((x: any) => x.showingId === showingId));

  // edit: visit time and agent (manager may reassign)
  assert.equal((await call(agentCookie, "PATCH", `/showings/${showingId}`, { visitAt: "2030-01-15T12:00" })).status, 200);
  assert.equal((await call(managerCookie, "PATCH", `/showings/${showingId}`, { responsibleUserId: manager.id })).status, 200);
  assert.equal((await db().showing.findUniqueOrThrow({ where: { id: showingId } })).responsibleUserId, manager.id);

  // preview: the approved ACTIVE wording only; blocked while incomplete
  r = await call(managerCookie, "GET", `/showings/${showingId}/preview`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(["BLOCKED", "TEMPLATE_UNAVAILABLE"].includes(r.body.preview.state), r.body.preview.state);
  assert.equal(r.body.preview.text, null);
  await installApprovedTemplate(db(), "SHOWING", "el");
  r = await call(managerCookie, "GET", `/showings/${showingId}/preview`);
  assert.ok(["BLOCKED", "READY"].includes(r.body.preview.state), r.body.preview.state);
  if (r.body.preview.state === "READY") assert.ok(r.body.preview.text.includes(p1.reference));
  assert.equal((await db().showing.findUniqueOrThrow({ where: { id: showingId } })).number, null, "a preview never issues or numbers the document");
  const tpl = await db().mandateTemplate.findUnique({ where: { type_locale: { type: "SHOWING", locale: "el" } } });
  if (tpl) await db().mandateTemplateVersion.updateMany({ where: { templateId: tpl.id, status: "ACTIVE" }, data: { status: "RETIRED", retiredAt: new Date() } });

  // Other agents do not see this showing
  const other = await mk("AGENT", "cwother");
  const otherCookie = await login(other.email);
  assert.equal((await call(otherCookie, "GET", `/showings/${showingId}/preview`)).status, 404);
  assert.equal((await call(otherCookie, "GET", `/showings?q=${RUN}`)).body.data.some((x: any) => x.id === showingId), false);

  await db().$disconnect();
});
