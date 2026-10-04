/**
 * End-to-end test of the owner pipeline, comparables and valuations through
 * the real API and a real Postgres. Runs only when TEST_DATABASE_URL points at
 * a disposable database with all migrations applied:
 *
 *   TEST_DATABASE_URL=postgresql://… npx tsx --test src/routes/sellers.integration.test.ts
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("owners, comparables and valuations: pipeline, privacy, permissions, immutability", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");

  const run = randomBytes(4).toString("hex");
  const RUN = run.toUpperCase();
  const city = `Πόλη-${run}`;
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) =>
    db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
  const [agentUser, other, manager] = await Promise.all([mk("AGENT", "sagent"), mk("AGENT", "sagent2"), mk("MANAGER", "smanager")]);

  let seq = 0;
  const prop = (o: Record<string, unknown>) => {
    seq += 1;
    return db().property.create({
      data: {
        reference: `IVL-${RUN}${seq}`, slug: `ivl-${run}-${seq}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Δοκιμή", descriptionEl: "Δοκιμή",
        city, areaName: "Κουκάκι", status: "ACTIVE", agentId: agentUser.id, bedrooms: 2, ...o,
      } as never,
    });
  };
  const subjectProp = await prop({ area: 100, status: "DRAFT" });
  const ask1 = await prop({ area: 95, price: 190000 }); // 2000/m²
  const ask2 = await prop({ area: 110, price: 231000, areaName: "Παγκράτι" }); // 2100/m²
  const sold = await prop({ area: 100, price: 215000, status: "SOLD" });
  const house = await prop({ area: 100, price: 300000, propertyType: "HOUSE" });
  const huge = await prop({ area: 300, price: 600000 });
  await db().transaction.create({
    data: { reference: `TRX-T${RUN}`, type: "SALE", status: "CLOSED", propertyId: sold.id, buyerName: "Δοκιμή", agreedAmount: 205000, closedAt: new Date(), agentId: agentUser.id, createdById: agentUser.id },
  });

  async function login(email: string) {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }
  const [agentCookie, otherCookie, managerCookie] = await Promise.all([login(agentUser.email), login(other.email), login(manager.email)]);
  const call = async (cookie: string, method: string, path: string, body?: unknown) => {
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  };

  // Contact details are never stored in clear: no key → refused.
  const savedKey = process.env.PII_ENCRYPTION_KEY;
  process.env.PII_ENCRYPTION_KEY = "";
  const refused = await call(agentCookie, "POST", "/sellers", { listingType: "SALE", firstName: "Μαρία", phone: "6900000000" });
  assert.equal(refused.status, 409);
  process.env.PII_ENCRYPTION_KEY = savedKey;

  // Create an owner with a past follow-up.
  const email = `owner-${run}@test.invalid`;
  const created = await call(agentCookie, "POST", "/sellers", {
    listingType: "SALE", firstName: "Μαρία", lastName: "Κ.", phone: "6900000000", email,
    propertyType: "APARTMENT", city, areaName: "Κουκάκι", area: 100, bedrooms: 2, askingPrice: 250000,
    motivation: "RELOCATION", timeframe: "3M", nextFollowUpAt: "2026-01-01",
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const sid = created.body.seller.id as string;
  assert.match(created.body.seller.reference, /^SEL-\d{6}$/);

  const lead = await db().sellerLead.findUniqueOrThrow({ where: { id: sid }, include: { contact: true } });
  assert.ok(lead.contact && lead.contact.roles.includes("SELLER"));
  assert.ok(lead.contact.phoneEncrypted?.startsWith("v1:"), "phone stored encrypted");
  assert.ok(!JSON.stringify(lead.contact).includes("6900000000"), "no plaintext phone at rest");
  const task = await db().task.findFirst({ where: { title: { contains: lead.reference } } });
  assert.ok(task && task.assignedToId === agentUser.id, "follow-up becomes a reminder");

  // Same email → same contact, no duplicate.
  const again = await call(agentCookie, "POST", "/sellers", { listingType: "RENT", firstName: "Μαρία", email });
  assert.equal(again.status, 200);
  const lead2 = await db().sellerLead.findUniqueOrThrow({ where: { id: again.body.seller.id }, include: { contact: true } });
  assert.equal(lead2.contactId, lead.contactId);
  assert.ok(lead2.contact!.roles.includes("LANDLORD"));

  let detail = await call(agentCookie, "GET", `/sellers/${sid}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.seller.contact.phone, "6900000000");
  assert.equal(detail.body.seller.followUpDue, true);
  const due = await call(agentCookie, "GET", "/sellers?followUp=due");
  assert.ok(due.body.data.some((s: any) => s.id === sid));
  assert.equal((await call(otherCookie, "GET", `/sellers/${sid}`)).status, 404, "other agents cannot see it");
  assert.equal((await call(managerCookie, "GET", `/sellers/${sid}`)).status, 200, "managers can");

  // Stages.
  assert.equal((await call(agentCookie, "POST", `/sellers/${sid}/stage`, { stage: "CONTACTED" })).status, 200);
  assert.equal((await call(agentCookie, "POST", `/sellers/${sid}/stage`, { stage: "LISTED" })).status, 400, "listing needs a property");
  assert.equal((await call(agentCookie, "POST", `/sellers/${sid}/stage`, { stage: "LOST" })).status, 400, "losing needs a reason");
  assert.equal((await call(agentCookie, "PATCH", `/sellers/${sid}`, { askingPrice: 240000, nextFollowUpAt: "2030-05-05" })).status, 200);

  // Valuation from the owner record.
  const val = await call(agentCookie, "POST", "/valuations", { sellerLeadId: sid });
  assert.equal(val.status, 200, JSON.stringify(val.body));
  const vid = val.body.valuation.id as string;
  assert.equal((await call(otherCookie, "GET", `/valuations/${vid}`)).status, 404);

  let v = await call(agentCookie, "GET", `/valuations/${vid}`);
  assert.equal(v.body.valuation.subject.area, 100);
  assert.equal(v.body.valuation.result.ok, false, "no comparables yet");

  const search = await call(agentCookie, "GET", `/valuations/${vid}/comparables/search?sizeTolerancePct=30`);
  assert.equal(search.status, 200);
  const ids = search.body.candidates.map((c: any) => `${c.reference}:${c.kind}`);
  assert.ok(ids.includes(`${ask1.reference}:ASKING`));
  assert.ok(ids.includes(`${ask2.reference}:ASKING`));
  assert.ok(ids.includes(`${sold.reference}:SOLD`), "closed transaction is a SOLD comparable at the agreed price");
  assert.ok(!ids.some((i: string) => i.startsWith(house.reference) || i.startsWith(huge.reference)), "other type and size are filtered out");
  assert.ok(!ids.some((i: string) => i.startsWith(subjectProp.reference)));
  assert.ok(!ids.includes(`${sold.reference}:ASKING`), "a sold property is not offered again at its asking price");
  const soldCand = search.body.candidates.find((c: any) => c.kind === "SOLD");
  assert.equal(soldCand.price, 205000);
  const sameArea = await call(agentCookie, "GET", `/valuations/${vid}/comparables/search?sameArea=1`);
  assert.ok(!sameArea.body.candidates.some((c: any) => c.reference === ask2.reference), "same-area filter");

  assert.equal((await call(agentCookie, "POST", `/valuations/${vid}/comparables`, { source: "INTERNAL", kind: "SOLD", propertyId: sold.id })).status, 200);
  assert.equal((await call(agentCookie, "POST", `/valuations/${vid}/comparables`, { source: "INTERNAL", kind: "SOLD", propertyId: sold.id })).status, 409, "no duplicates");
  assert.equal((await call(agentCookie, "POST", `/valuations/${vid}/comparables`, { source: "INTERNAL", kind: "ASKING", propertyId: sold.id })).status, 409, "one comparable per property");
  const after = await call(agentCookie, "GET", `/valuations/${vid}/comparables/search`);
  assert.ok(!after.body.candidates.some((c: any) => c.reference === sold.reference), "used property is not offered again");
  assert.equal((await call(agentCookie, "POST", `/valuations/${vid}/comparables`, { source: "INTERNAL", kind: "ASKING", propertyId: ask1.id, adjustmentPct: -5 })).status, 400, "adjustment needs a reason");
  assert.equal((await call(agentCookie, "POST", `/valuations/${vid}/comparables`, { source: "INTERNAL", kind: "ASKING", propertyId: ask1.id, adjustmentPct: 5, adjustmentReason: "Χωρίς ασανσέρ" })).status, 200);
  assert.equal(
    (await call(agentCookie, "POST", `/valuations/${vid}/comparables`, { source: "EXTERNAL", label: "Διαμέρισμα 98 m²", origin: "Αγγελία portal", price: 196000, area: 98, city })).status,
    200,
  );

  v = await call(agentCookie, "GET", `/valuations/${vid}`);
  const r = v.body.valuation.result;
  assert.ok(r.ok, JSON.stringify(r));
  // 205000/100 = 2050; 2000 × 1.05 = 2100; 196000/98 = 2000 → median 2050, range 2000–2100.
  assert.deepEqual([r.count, r.medianPerSqm, r.lowPerSqm, r.highPerSqm, r.estimate, r.low, r.high], [3, 2050, 2000, 2100, 205000, 200000, 210000]);

  // Exclude one → recalculated and stored.
  const ext = v.body.valuation.comparables.find((c: any) => c.kind === "EXTERNAL");
  assert.equal((await call(agentCookie, "PATCH", `/valuations/${vid}/comparables/${ext.id}`, { included: false })).status, 200);
  const stored = await db().valuation.findUniqueOrThrow({ where: { id: vid } });
  assert.equal(stored.compCount, 2);
  assert.equal(Number(stored.estimate), 207500);

  // Finalise.
  assert.equal((await call(agentCookie, "POST", `/valuations/${vid}/finalize`, { recommendedPrice: 209000 })).status, 422, "needs a rationale");
  assert.equal((await call(agentCookie, "POST", `/valuations/${vid}/finalize`, { recommendedPrice: 209000, rationale: "Εντός εύρους συγκριτικών." })).status, 200);
  assert.equal((await call(agentCookie, "PATCH", `/valuations/${vid}/comparables/${ext.id}`, { included: true })).status, 409, "final is frozen");
  await assert.rejects(db().valuation.update({ where: { id: vid }, data: { recommendedPrice: 1 } }), "database refuses editing a final valuation");
  await assert.rejects(db().valuation.delete({ where: { id: vid } }));
  await assert.rejects(db().valuationComparable.delete({ where: { id: ext.id } }));
  await assert.rejects(db().valuationComparable.create({ data: { valuationId: vid, kind: "EXTERNAL", label: "x", price: 1, area: 1 } }));

  const dup = await call(agentCookie, "POST", `/valuations/${vid}/duplicate`, {});
  assert.equal(dup.status, 200, JSON.stringify(dup.body));
  const dupRow = await db().valuation.findUniqueOrThrow({ where: { id: dup.body.valuation.id }, include: { comparables: true } });
  assert.equal(dupRow.status, "DRAFT");
  assert.equal(dupRow.comparables.length, 3);

  // List → listed: the property becomes the owner's.
  assert.equal((await call(agentCookie, "POST", `/sellers/${sid}/stage`, { stage: "LISTED", propertyReference: subjectProp.reference })).status, 200);
  const listed = await db().property.findUniqueOrThrow({ where: { id: subjectProp.id } });
  assert.equal(listed.ownerId, lead.contactId);
  assert.equal((await call(agentCookie, "POST", `/sellers/${sid}/stage`, { stage: "NEW" })).status, 409, "listed is final");

  detail = await call(agentCookie, "GET", `/sellers/${sid}`);
  const types = detail.body.seller.events.map((e: any) => e.type);
  for (const t of ["CREATED", "STAGE", "UPDATED", "FOLLOW_UP", "VALUATION", "VALUATION_FINAL"]) assert.ok(types.includes(t), `timeline has ${t}`);
  const anyEvent = await db().sellerLeadEvent.findFirstOrThrow({ where: { sellerLeadId: sid } });
  await assert.rejects(db().sellerLeadEvent.update({ where: { id: anyEvent.id }, data: { summary: "edited" } }));

  // Owner report: activity without buyer identities.
  await db().viewing.create({
    data: { propertyId: subjectProp.id, clientName: "Αγοραστής Μυστικός", clientPhone: "6911111111", startsAt: new Date(Date.now() - 86_400_000), status: "COMPLETED", feedback: "Του άρεσε, ακριβό.", agentId: agentUser.id },
  });
  await db().offer.create({ data: { reference: `OFR-T${RUN}`, propertyId: subjectProp.id, amount: 198000, agentId: agentUser.id } });
  const report = await call(agentCookie, "GET", `/contacts/${lead.contactId}/owner-report`);
  assert.equal(report.status, 200);
  const rp = report.body.properties.find((p: any) => p.reference === subjectProp.reference);
  assert.equal(rp.viewings.completed, 1);
  assert.equal(rp.viewings.feedback[0].feedback, "Του άρεσε, ακριβό.");
  assert.equal(rp.offers.highest, 198000);
  assert.equal(rp.valuation, null, "valuation is linked to the owner, not yet to the property");
  const raw = JSON.stringify(report.body);
  assert.ok(!raw.includes("Μυστικός") && !raw.includes("6911111111"), "buyers are never named in the owner report");

  await db().$disconnect();
});
