/**
 * Website-side glue for the indicative valuation engine.
 *
 * The maths lives in `@home88/valuation` and is pure; this file only fetches
 * real comparable listings and hands them over. If there is no database (or too
 * few comparables) the engine refuses to estimate and the page shows an honest
 * "not enough data" message instead of a made-up number.
 */

import { PUBLIC_PROPERTY_STATUSES } from "@home88/domain";
import type { Prisma } from "@home88/database";
import {
  estimateValuation,
  type Comparable,
  type EstimateOptions,
  type ValuationEstimate,
  type ValuationInput,
} from "@home88/valuation";

import { safeQuery } from "./db";

/** Only these statuses are ever visible on the public site (owned by @home88/domain). */
const PUBLIC_STATUSES = PUBLIC_PROPERTY_STATUSES;

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function fetchComparables(input: ValuationInput, take = 60): Promise<Comparable[]> {
  const where: Prisma.PropertyWhereInput = {
    publishedOnWebsite: true,
    status: { in: [...PUBLIC_STATUSES] },
    listingType: "SALE",
    area: { not: null },
    price: { not: null },
  };
  if (input.city) where.city = { equals: input.city, mode: "insensitive" };
  if (input.areaName) where.areaName = { equals: input.areaName, mode: "insensitive" };

  return safeQuery(
    "fetchComparables",
    async (db) => {
      const rows = await db.property.findMany({
        where,
        take,
        orderBy: { updatedAt: "desc" },
        select: { price: true, area: true, propertyType: true },
      });
      return rows.map((r) => ({
        price: num(r.price),
        area: num(r.area),
        propertyType: r.propertyType,
      }));
    },
    [],
  );
}

export async function estimateFromDatabase(
  input: ValuationInput,
  options: EstimateOptions = {},
): Promise<{ comparables: Comparable[]; result: ValuationEstimate }> {
  const comparables = await fetchComparables(input);
  return { comparables, result: estimateValuation(input, comparables, options) };
}
