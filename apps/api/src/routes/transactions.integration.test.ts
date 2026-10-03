/**
 * End-to-end test of the transaction lifecycle through the real API and a
 * real Postgres. Runs only when TEST_DATABASE_URL points at a disposable
 * database with all migrations applied:
 *
 *   TEST_DATABASE_URL=postgresql://… npx tsx --test src/routes/transactions.integration.test.ts
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("transaction lifecycle: negotiation, agreement, commission, permissions, immutability", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");

  // Start from unconfigured commission rules so the test can be re-run.
  await db().commissionSettings.deleteMany({});

  const run = randomBytes(4).toString("hex");
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) =>
    db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
  const [agentUser, other, manager, admin] = await Promise.all([mk("AGENT", "agent"), mk("AGENT", "agent2"), mk("MANAGER", "manager"), mk("ADMIN", "admin")]);
  const property = await db().property.create({
    data: { reference: `ITX-${run.toUpperCase()}`, slug: `itx-${run}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Δοκιμή", descriptionEl: "Δοκιμή", agentId: agentUser.id, status: "ACTIVE" },
  });

  async function login(email: string) {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }
  const [agentCookie, otherCookie, managerCookie, adminCookie] = await Promise.all([login(agentUser.email), login(other.email), login(manager.email), login(admin.email)]);
  const call = async (cookie: string, method: string, path: string, body?: unknown) => {
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  };

  // Create and negotiate.
  const created = await call(agentCookie, "POST", "/transactions", { propertyReference: property.reference, buyerName: "Γιώργος Π." });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const tid = created.body.transaction.id as string;
  assert.match(created.body.transaction.reference, /^TRX-\d{6}$/);

  assert.equal((await call(agentCookie, "POST", `/transactions/${tid}/offers`, { party: "BUYER", amount: 440000 })).status, 200);
  assert.equal((await call(agentCookie, "POST", `/transactions/${tid}/offers`, { party: "BUYER", amount: 445000 })).status, 409, "same side cannot bid twice in a row");
  assert.equal((await call(agentCookie, "POST", `/transactions/${tid}/offers`, { party: "SELLER", amount: 480000, conditions: "Παράδοση 01/2027" })).status, 200);
  assert.equal((await call(agentCookie, "POST", `/transactions/${tid}/offers`, { party: "BUYER", amount: 465000, financing: "MORTGAGE" })).status, 200);

  let detail = await call(agentCookie, "GET", `/transactions/${tid}`);
  assert.equal(detail.status, 200);
  const offers = detail.body.transaction.offers;
  assert.deepEqual(offers.map((o: any) => [o.round, o.party, o.amount, o.status]), [
    [1, "BUYER", 440000, "COUNTERED"],
    [2, "SELLER", 480000, "COUNTERED"],
    [3, "BUYER", 465000, "SUBMITTED"],
  ]);

  // Others cannot see it; the database refuses rewriting history.
  assert.equal((await call(otherCookie, "GET", `/transactions/${tid}`)).status, 404);
  await assert.rejects(db().offer.update({ where: { id: offers[0].id }, data: { amount: 1 } }));
  await assert.rejects(db().offer.delete({ where: { id: offers[0].id } }));

  // Accept → agreement.
  const accept = await call(agentCookie, "POST", `/transactions/${tid}/offers/${offers[2].id}/respond`, { action: "ACCEPT" });
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  detail = await call(agentCookie, "GET", `/transactions/${tid}`);
  assert.equal(detail.body.transaction.status, "AGREEMENT");
  assert.equal(detail.body.transaction.agreedAmount, 465000);
  assert.equal(detail.body.commissionPreview.ok, false, "no rules configured yet");

  // No invented rates: calculation is refused until Settings are filled.
  const refused = await call(agentCookie, "POST", `/transactions/${tid}/commission`, {});
  assert.equal(refused.status, 409);
  assert.match(refused.body.error.message, /Ρυθμίσεις → Προμήθειες/);

  const settings = await call(adminCookie, "PUT", "/settings/sections/commissions", {
    values: { saleCommissionPct: 2, agentSharePct: 40, agencySharePct: 60, vatMode: "EXCLUSIVE", vatRatePct: 24 },
  });
  assert.equal(settings.status, 200, JSON.stringify(settings.body));

  assert.equal((await call(agentCookie, "POST", `/transactions/${tid}/commission`, { overrideRate: 1.5, overrideReason: "x" })).status, 403, "agents cannot override");
  assert.equal((await call(agentCookie, "POST", `/transactions/${tid}/commission`, {})).status, 200);
  detail = await call(agentCookie, "GET", `/transactions/${tid}`);
  const c = detail.body.transaction.commission;
  assert.deepEqual([c.net, c.vat, c.gross, c.agentShare, c.agencyShare], [9300, 2232, 11532, 3720, 5580]);

  assert.equal((await call(managerCookie, "POST", `/transactions/${tid}/commission`, { overrideRate: 1.5 })).status, 400, "override needs a reason");
  assert.equal((await call(managerCookie, "POST", `/transactions/${tid}/commission`, { overrideRate: 1.5, overrideReason: "Συμφωνία με ιδιοκτήτη" })).status, 200);
  assert.equal((await call(agentCookie, "PATCH", `/transactions/${tid}/commission`, { status: "INVOICED" })).status, 403, "payments are manager-only");
  assert.equal((await call(managerCookie, "PATCH", `/transactions/${tid}/commission`, { status: "INVOICED", invoiceNumber: "A-12", dueDate: "2026-01-01" })).status, 200);
  detail = await call(managerCookie, "GET", `/transactions/${tid}`);
  assert.equal(detail.body.transaction.commission.status, "OVERDUE", "derived from the due date");
  assert.equal((await call(managerCookie, "POST", `/transactions/${tid}/commission`, {})).status, 409, "invoiced commission is frozen");

  // Checklist, notes, contract, closing.
  assert.equal((await call(agentCookie, "POST", `/transactions/${tid}/checklist`, { label: "Ενεργειακό πιστοποιητικό" })).status, 200);
  detail = await call(agentCookie, "GET", `/transactions/${tid}`);
  const item = detail.body.transaction.checklist[0];
  assert.equal((await call(agentCookie, "PATCH", `/transactions/${tid}/checklist/${item.id}`, { status: "RECEIVED" })).status, 200);
  assert.equal((await call(agentCookie, "POST", `/transactions/${tid}/notes`, { text: "Ραντεβού συμβολαιογράφου" })).status, 200);
  assert.equal((await call(agentCookie, "POST", `/transactions/${tid}/status`, { status: "CLOSED" })).status, 200, "agreement can close directly");
  assert.equal((await call(agentCookie, "POST", `/transactions/${tid}/status`, { status: "CANCELLED", reason: "x" })).status, 409, "closed is final");

  // Timeline: append-only and complete.
  detail = await call(agentCookie, "GET", `/transactions/${tid}`);
  const types = detail.body.transaction.events.map((e: any) => e.type);
  for (const t of ["CREATED", "OFFER", "COUNTER_OFFER", "OFFER_ACCEPTED", "STATUS", "COMMISSION", "COMMISSION_STATUS", "DOCUMENT_REQUESTED", "DOCUMENT_STATUS", "NOTE"]) {
    assert.ok(types.includes(t), `timeline has ${t}`);
  }
  const anyEvent = await db().transactionEvent.findFirstOrThrow({ where: { transactionId: tid } });
  await assert.rejects(db().transactionEvent.update({ where: { id: anyEvent.id }, data: { summary: "edited" } }));

  // The audit trail for settings still masks nothing it should not, and the
  // commission settings change is recorded with old → new.
  const audit = await db().settingsAuditLog.findFirst({ where: { section: "commissions", field: "saleCommissionPct" }, orderBy: { createdAt: "desc" } });
  assert.equal(Number(audit?.newValue), 2);

  await db().$disconnect();
});
