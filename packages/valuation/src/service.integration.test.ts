/**
 * Runs the valuation service against a real Postgres with the HOME88 schema.
 * Skipped unless VALUATION_TEST_DATABASE_URL points at a disposable database.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@home88/database";

import { publicView, valuateAndStore } from "./service";
import type { Subject } from "./engine";

const url = process.env.VALUATION_TEST_DATABASE_URL;
const SKIP = url ? false : "VALUATION_TEST_DATABASE_URL not set";
const REF = new Date("2026-10-01T00:00:00Z");
// A town of its own per run, so other data in the database never interferes.
const RUN = Math.random().toString(36).slice(2, 8);
const TOWN = `Δοκιμόπολη ${RUN}`;
const AREA = `Άνω Συνοικία ${RUN}`;

describe("valuation service (database)", { skip: SKIP }, () => {
  let db: PrismaClient;
  let n = 0;

  async function property(over: Record<string, unknown> = {}) {
    n += 1;
    return db.property.create({
      data: {
        reference: `T-${RUN}-${n}`, slug: `t-${RUN}-${n}`, listingType: "SALE", propertyType: "APARTMENT", status: "ACTIVE",
        publishedOnWebsite: true, titleEl: `Δοκιμή ${n}`, descriptionEl: "x", price: 400_000, area: 100,
        region: `Περιφέρεια ${RUN}`, city: TOWN, areaName: AREA, condition: "GOOD", yearBuilt: 2005, floor: 2, bedrooms: 2,
        parking: true, storage: true, updatedAt: new Date("2026-09-01"),
        ...over,
      } as never,
    });
  }

  const subject: Subject = {
    propertyType: "APARTMENT", areaSqm: 100, location: { region: `Περιφέρεια ${RUN}`, city: TOWN.toUpperCase(), area: AREA.normalize("NFD").replace(/\p{M}/gu, "") },
    condition: "GOOD", yearBuilt: 2005, floor: 2, bedrooms: 2, features: { parking: true, storage: true },
  };

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
  });
  after(async () => db.$disconnect());
  beforeEach(async () => {
    await db.valuationRequest.deleteMany({ where: { region: `Περιφέρεια ${RUN}` } });
    await db.transaction.deleteMany({ where: { reference: { startsWith: `TRX-${RUN}` } } });
    await db.property.deleteMany({ where: { reference: { startsWith: `T-${RUN}-` } } });
  });

  it("values from real HOME88 listings and closed deals, and freezes what it used", async () => {
    for (const p of [3900, 3950, 4000, 4050, 4100]) await property({ price: p * 100 });
    const sold = await property({ status: "SOLD", publishedOnWebsite: false, price: 999_000 });
    await db.transaction.create({
      data: { reference: `TRX-${RUN}-1`, type: "SALE", status: "CLOSED", propertyId: sold.id, buyerName: "Αγοραστής", agreedAmount: 395_000, closedAt: new Date("2026-08-15") },
    });
    // Not eligible: draft, rental, other city, not on the website.
    await property({ status: "DRAFT" });
    await property({ listingType: "RENT", price: 1500 });
    await property({ city: `Άλλη πόλη ${RUN}`, areaName: "Κέντρο", region: `Άλλη περιφέρεια ${RUN}` });
    await property({ publishedOnWebsite: false });

    const out = await valuateAndStore(db, subject, { referenceDate: REF, idempotencyKey: `k1-${RUN}` });
    assert.equal(out.result.status, "OK");
    if (out.result.status !== "OK") return;
    assert.equal(out.result.comparableCount, 6);
    assert.equal(out.result.transactionCount, 1, "the closed deal counts as a transaction, at its agreed price");
    assert.equal(out.result.askingCount, 5);
    assert.match(out.reference ?? "", /^EKT-\d{6}$/);

    const stored = await db.valuationRequest.findUniqueOrThrow({ where: { id: out.id! }, include: { comparables: true } });
    assert.equal(stored.status, "COMPLETED");
    assert.equal(Number(stored.estimatedValue), out.result.midpoint);
    assert.equal(stored.comparables.length, 6);
    const deal = stored.comparables.find((c) => c.observationType === "TRANSACTION")!;
    assert.equal(Number(deal.price), 395_000);
    assert.equal(deal.propertyId, sold.id);

    // A later price change does not rewrite the historical valuation.
    const first = stored.comparables.find((c) => c.observationType === "ASKING")!;
    await db.property.update({ where: { id: first.propertyId! }, data: { price: 1 } });
    const again = await db.valuationRequestComparable.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(Number(again.price), Number(first.price));

    // The same submission twice is stored once.
    const replay = await valuateAndStore(db, subject, { referenceDate: REF, idempotencyKey: `k1-${RUN}` });
    assert.equal(replay.replayed, true);
    assert.equal(replay.reference, out.reference);
    assert.equal(await db.valuationRequest.count({ where: { region: `Περιφέρεια ${RUN}` } }), 1);

    // The public view carries no ids, addresses or comparables.
    const pub = JSON.stringify(publicView(out.result));
    assert.ok(!pub.includes(sold.id) && !pub.includes(`T-${RUN}`) && !pub.includes("comparables"));
  });

  it("with too little data it stores INSUFFICIENT_DATA and no number", async () => {
    await property();
    await property();
    const out = await valuateAndStore(db, subject, { referenceDate: REF });
    assert.equal(out.result.status, "INSUFFICIENT_DATA");
    const stored = await db.valuationRequest.findUniqueOrThrow({ where: { id: out.id! } });
    assert.equal(stored.status, "INSUFFICIENT_DATA");
    assert.equal(stored.estimatedValue, null);
  });

  it("the automated result cannot be changed afterwards", async () => {
    for (const p of [3900, 3950, 4000, 4050, 4100]) await property({ price: p * 100 });
    const out = await valuateAndStore(db, subject, { referenceDate: REF });
    await db.valuationRequest.update({ where: { id: out.id! }, data: { stage: "CONTACTED" } });
    await assert.rejects(db.valuationRequest.update({ where: { id: out.id! }, data: { estimatedValue: 1 } }), /cannot be changed/);
  });

  it("imported observations are ignored until their source is cleared for valuation", async () => {
    for (const p of [3900, 3950, 4000, 4050]) await property({ price: p * 100 });
    await db.marketObservation.deleteMany({ where: { sourceRecordId: { startsWith: RUN } } });
    for (let i = 0; i < 5; i++) {
      await db.marketObservation.create({
        data: {
          sourceId: "mds_mama", sourceRecordId: `${RUN}-${i}`, observationType: "TRANSACTION", propertyType: "APARTMENT",
          city: TOWN, areaName: AREA, areaSqm: 100, price: 380_000, observedAt: new Date("2026-06-01"), rawPayload: {},
        },
      });
    }
    const off = await valuateAndStore(db, subject, { referenceDate: REF });
    assert.equal(off.result.status, "INSUFFICIENT_DATA", "inactive source (MAMA) is not read");
    await db.marketDataSource.update({ where: { id: "mds_mama" }, data: { active: true, usableForValuation: true } });
    const on = await valuateAndStore(db, subject, { referenceDate: REF });
    assert.equal(on.result.status, "OK");
    if (on.result.status === "OK") assert.equal(on.result.transactionCount, 5);
    await db.marketDataSource.update({ where: { id: "mds_mama" }, data: { active: false, usableForValuation: false } });
    await db.marketObservation.deleteMany({ where: { sourceRecordId: { startsWith: RUN } } });
  });
});
