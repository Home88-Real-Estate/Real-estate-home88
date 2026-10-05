/**
 * Failure handling of the valuation service, with a stub database:
 * each stage fails the way a real Prisma client does.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@home88/database";

import { ValuationFailure, valuateAndStore } from "./service";
import type { Subject } from "./engine";

const REF = new Date("2026-10-01T00:00:00Z");
const subject: Subject = { propertyType: "APARTMENT", areaSqm: 100, location: { region: "Αττική", city: "Γλυφάδα", area: "Άνω Γλυφάδα" } };

const prismaError = (code: string) => Object.assign(new Error(`prisma ${code}`), { code });
const listing = (i: number) => ({
  id: `p${i}`, reference: `R${i}`, propertyType: "APARTMENT", price: 400_000 + i * 5_000, area: 100, region: "Αττική", city: "Γλυφάδα",
  areaName: "Άνω Γλυφάδα", condition: null, yearBuilt: null, floor: null, bedrooms: null, bathrooms: null, parking: null, storage: null,
  elevator: null, garden: null, pool: null, seaView: null, furnished: null, updatedAt: new Date("2026-09-01"),
});

type Fail = Partial<Record<"replay" | "properties" | "observations" | "persist", Error>>;
function stubDb(fail: Fail = {}, listings = 6) {
  const reject = (e?: Error) => (e ? Promise.reject(e) : null);
  return {
    valuationRequest: { findUnique: async () => reject(fail.replay) ?? null },
    transaction: { findMany: async () => [] },
    property: { findMany: async () => reject(fail.properties) ?? Array.from({ length: listings }, (_, i) => listing(i)) },
    marketObservation: { findMany: () => (fail.observations ? Promise.reject(fail.observations) : Promise.resolve([])) },
    $transaction: async () => {
      if (fail.persist) throw fail.persist;
      return { id: "vr1", reference: "EKT-000001" };
    },
  } as unknown as PrismaClient;
}

const quiet = async <T>(fn: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

describe("valuation service failures", () => {
  it("a missing table anywhere is SCHEMA_OUT_OF_DATE, never worked around", async () => {
    for (const stage of ["replay", "properties", "observations", "persist"] as const) {
      await assert.rejects(
        quiet(() => valuateAndStore(stubDb({ [stage]: prismaError("P2021") }), subject, { referenceDate: REF, idempotencyKey: "k" })),
        (e: unknown) => e instanceof ValuationFailure && e.code === "SCHEMA_OUT_OF_DATE",
        stage,
      );
    }
  });

  it("HOME88 evidence that cannot be read is a DATABASE_ERROR", async () => {
    await assert.rejects(
      quiet(() => valuateAndStore(stubDb({ properties: prismaError("P1001") }), subject, { referenceDate: REF })),
      (e: unknown) => e instanceof ValuationFailure && e.code === "DATABASE_ERROR" && e.stage === "LOAD_EVIDENCE",
    );
  });

  it("a transient storage failure still returns the computed result, unstored", async () => {
    const out = await quiet(() => valuateAndStore(stubDb({ persist: prismaError("P2034") }), subject, { referenceDate: REF }));
    assert.equal(out.result.status, "OK");
    assert.equal(out.id, null);
    assert.equal(out.reference, null);
  });

  it("imported observations are optional: a transient read failure is skipped", async () => {
    const out = await quiet(() => valuateAndStore(stubDb({ observations: prismaError("P1008") }), subject, { referenceDate: REF }));
    assert.equal(out.result.status, "OK");
    assert.equal(out.id, "vr1");
  });

  it("too few comparables is a result, not an error", async () => {
    const out = await valuateAndStore(stubDb({}, 2), subject, { referenceDate: REF });
    assert.equal(out.result.status, "INSUFFICIENT_DATA");
  });
});
