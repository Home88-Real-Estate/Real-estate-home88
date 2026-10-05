/**
 * Server-side valuation service: loads real observations, runs the engine and
 * stores the request with a frozen snapshot of every comparable it used.
 *
 * Candidate sources (each tagged, never mixed up):
 *   - HOME88 published sale listings          → ASKING      (asking price)
 *   - HOME88 closed sale transactions         → TRANSACTION (agreed price)
 *   - market_observations from sources that are active AND usable for
 *     valuation (none of the public ones are, until their importers exist)
 *
 * Nothing here trusts the browser: the caller passes a validated subject and
 * the numbers all come from the database.
 */

import type { Prisma, PrismaClient } from "@home88/database";

import {
  DEFAULT_CONFIG,
  FEATURE_KEYS,
  runComparableEngine,
  type Candidate,
  type EngineConfig,
  type EngineResult,
  type FeatureKey,
  type ObservationType,
  type Subject,
} from "./engine";

/** Statuses in which a HOME88 listing is on the market (mirrors @home88/domain PUBLIC_PROPERTY_STATUSES). */
const MARKET_STATUSES = ["ACTIVE", "UNDER_OFFER", "RESERVED"] as const;
const LAND_TYPES = new Set(["LAND", "PLOT"]);
/** At most this many rows per source are considered (HOME88's own inventory is far smaller). */
const MAX_ROWS = 5000;

type Db = PrismaClient | Prisma.TransactionClient;
type Snapshot = { propertyId: string | null; snapshot: Record<string, unknown> };

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function familyOf(type: string, config: EngineConfig): string[] {
  const fam = config.typeFamilies.filter((f) => f.includes(type)).flat();
  return fam.length ? [...new Set(fam)] : [type];
}

function propertyFeatures(p: { parking: boolean; storage: boolean; balcony: boolean; garden: boolean; pool: boolean; seaView: boolean; details: unknown }) {
  const details = p.details && typeof p.details === "object" ? (p.details as Record<string, unknown>) : {};
  return {
    parking: p.parking,
    storage: p.storage,
    balcony: p.balcony,
    garden: p.garden,
    pool: p.pool,
    seaView: p.seaView,
    elevator: typeof details.elevator === "boolean" ? details.elevator : null,
  } satisfies Partial<Record<FeatureKey, boolean | null>>;
}

const propertySelect = {
  id: true, reference: true, propertyType: true, price: true, area: true, plotArea: true,
  region: true, city: true, areaName: true, condition: true, yearBuilt: true, floor: true,
  bedrooms: true, bathrooms: true, parking: true, storage: true, balcony: true, garden: true,
  pool: true, seaView: true, details: true, updatedAt: true,
} satisfies Prisma.PropertySelect;
type PropertyRow = Prisma.PropertyGetPayload<{ select: typeof propertySelect }>;

function fromProperty(p: PropertyRow, type: ObservationType, price: number, observedAt: Date, id: string): { candidate: Candidate; snap: Snapshot } {
  const areaSqm = num(LAND_TYPES.has(p.propertyType) ? (p.plotArea ?? p.area) : (p.area ?? p.plotArea)) ?? 0;
  const candidate: Candidate = {
    id,
    source: "HOME88",
    observationType: type,
    propertyType: p.propertyType,
    price,
    areaSqm,
    location: { region: p.region, city: p.city, area: p.areaName },
    condition: p.condition,
    yearBuilt: p.yearBuilt,
    floor: p.floor,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    features: propertyFeatures(p),
    observedAt,
  };
  return {
    candidate,
    snap: {
      propertyId: p.id,
      snapshot: {
        reference: p.reference, propertyType: p.propertyType, price, areaSqm, region: p.region, city: p.city,
        areaName: p.areaName, condition: p.condition, yearBuilt: p.yearBuilt, floor: p.floor, bedrooms: p.bedrooms,
        bathrooms: p.bathrooms, features: candidate.features, observedAt: observedAt.toISOString(), observationType: type,
      },
    },
  };
}

/** Every candidate the engine may consider for this subject, with what to freeze if it is used. */
export async function loadCandidates(
  db: Db,
  subject: Subject,
  referenceDate: Date,
  config: EngineConfig = DEFAULT_CONFIG,
): Promise<{ candidates: Candidate[]; snapshots: Map<string, Snapshot> }> {
  const types = familyOf(subject.propertyType, config);
  const since = new Date(referenceDate.getTime() - config.maxAgeMonths * 30.4375 * 86_400_000);
  const candidates: Candidate[] = [];
  const snapshots = new Map<string, Snapshot>();

  // 1. Closed HOME88 sales: the agreed price, dated when the deal closed.
  const deals = await db.transaction.findMany({
    where: { type: "SALE", status: "CLOSED", agreedAmount: { not: null }, closedAt: { gte: since }, property: { propertyType: { in: types as never[] } } },
    select: { id: true, agreedAmount: true, closedAt: true, property: { select: propertySelect } },
    orderBy: { closedAt: "desc" },
    take: MAX_ROWS,
  });
  const soldProperties = new Set<string>();
  for (const d of deals) {
    const price = num(d.agreedAmount);
    if (!price || !d.closedAt) continue;
    const { candidate, snap } = fromProperty(d.property, "TRANSACTION", price, d.closedAt, `transaction:${d.id}`);
    candidates.push(candidate);
    snapshots.set(candidate.id, snap);
    soldProperties.add(d.property.id);
  }

  // 2. HOME88 sale listings on the market: the asking price, dated by the last update.
  const listings = await db.property.findMany({
    where: {
      listingType: "SALE",
      status: { in: [...MARKET_STATUSES] },
      publishedOnWebsite: true,
      price: { not: null },
      propertyType: { in: types as never[] },
      updatedAt: { gte: since },
    },
    select: propertySelect,
    orderBy: { updatedAt: "desc" },
    take: MAX_ROWS,
  });
  for (const p of listings) {
    if (soldProperties.has(p.id)) continue; // the same asset is never counted twice
    const price = num(p.price);
    if (!price) continue;
    const { candidate, snap } = fromProperty(p, "ASKING", price, p.updatedAt, `property:${p.id}`);
    candidates.push(candidate);
    snapshots.set(candidate.id, snap);
  }

  // 3. Imported market observations, only from sources cleared for valuation.
  //    Optional evidence: a transient read failure is logged and the valuation
  //    continues on HOME88's own data. A missing table is not transient.
  const observations = await db.marketObservation.findMany({
    where: {
      source: { active: true, usableForValuation: true, code: { not: "HOME88" } },
      observationType: { in: ["TRANSACTION", "ASKING"] },
      propertyType: { in: types },
      observedAt: { gte: since },
      areaSqm: { not: null },
    },
    select: {
      id: true, sourceRecordId: true, observationType: true, propertyType: true, price: true, areaSqm: true,
      region: true, city: true, areaName: true, condition: true, yearBuilt: true, floor: true, bedrooms: true,
      bathrooms: true, features: true, observedAt: true, source: { select: { code: true } },
    },
    orderBy: { observedAt: "desc" },
    take: MAX_ROWS * 4,
  }).catch((error: unknown) => {
    // A missing table/column is a deployment fault (migrations not applied): never run around it.
    if (SCHEMA_CODES.has(errorCode(error))) throw error;
    console.error("[home88:valuation] MARKET_DATA_UNAVAILABLE: imported observations skipped", errorCode(error));
    return [];
  });
  for (const o of observations) {
    const price = num(o.price);
    const areaSqm = num(o.areaSqm);
    if (!price || !areaSqm || !o.propertyType) continue;
    const features = o.features && typeof o.features === "object" ? (o.features as Record<string, unknown>) : {};
    const candidate: Candidate = {
      id: `observation:${o.id}`,
      source: o.source.code,
      observationType: o.observationType as ObservationType,
      propertyType: o.propertyType,
      price,
      areaSqm,
      location: { region: o.region, city: o.city, area: o.areaName },
      condition: o.condition,
      yearBuilt: o.yearBuilt,
      floor: o.floor,
      bedrooms: o.bedrooms,
      bathrooms: o.bathrooms,
      features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, typeof features[k] === "boolean" ? (features[k] as boolean) : null])),
      observedAt: o.observedAt,
    };
    candidates.push(candidate);
    snapshots.set(candidate.id, {
      propertyId: null,
      snapshot: { source: o.source.code, sourceRecordId: o.sourceRecordId, observationType: o.observationType, propertyType: o.propertyType, price, areaSqm, region: o.region, city: o.city, areaName: o.areaName, observedAt: o.observedAt.toISOString() },
    });
  }

  return { candidates, snapshots };
}

async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.referenceCounter.upsert({
    where: { scope: "valuation_request" },
    create: { scope: "valuation_request", nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `EKT-${String(counter.nextValue - 1).padStart(6, "0")}`;
}

export type ValuateOptions = {
  referenceDate?: Date;
  config?: EngineConfig;
  channel?: string;
  /** Same key → the stored request is returned instead of a second one. */
  idempotencyKey?: string | null;
};

export type StoredValuation = {
  /** Null when the result could not be stored (the failure is logged as SNAPSHOT_ERROR). */
  id: string | null;
  reference: string | null;
  result: EngineResult;
  replayed: boolean;
};

/** Where a valuation failed, so callers can answer and log precisely. */
export type ValuationStage = "REPLAY" | "LOAD_EVIDENCE" | "ENGINE" | "PERSIST";
export class ValuationFailure extends Error {
  constructor(
    readonly code: "DATABASE_ERROR" | "SCHEMA_OUT_OF_DATE" | "VALUATION_ENGINE_ERROR",
    readonly stage: ValuationStage,
    override readonly cause: unknown,
  ) {
    super(`${code} at ${stage}`);
  }
}

/** Prisma's error code (P2021 = missing table, P1001 = unreachable, ...) or the error class. */
export function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") return (error as { code: string }).code;
  return error instanceof Error ? error.constructor.name : "unknown";
}
const SCHEMA_CODES = new Set(["P2021", "P2022"]);

/**
 * Runs a valuation in three stages and stores it.
 *
 *  1. LOAD_EVIDENCE — HOME88's own data is required; failure is a DATABASE_ERROR
 *     (or SCHEMA_OUT_OF_DATE when a table/column is missing).
 *  2. ENGINE        — pure calculation; INSUFFICIENT_DATA is a normal result.
 *  3. PERSIST       — request + frozen comparables in one transaction. If this
 *     fails the result is still returned (with id null) and the failure is
 *     logged as SNAPSHOT_ERROR, so a storage problem never hides a valid answer.
 *
 *  A missing table or column (Prisma P2021/P2022) at any stage means the
 *  database is behind the code: that is always SCHEMA_OUT_OF_DATE, never
 *  worked around, so a deployment without its migrations fails visibly.
 */
export async function valuateAndStore(db: PrismaClient, subject: Subject, options: ValuateOptions = {}): Promise<StoredValuation> {
  const config = options.config ?? DEFAULT_CONFIG;
  const referenceDate = options.referenceDate ?? new Date();

  if (options.idempotencyKey) {
    try {
      const existing = await db.valuationRequest.findUnique({ where: { idempotencyKey: options.idempotencyKey }, select: { id: true } });
      if (existing) {
        const stored = await loadStoredResult(db, existing.id);
        if (stored) return { ...stored, replayed: true };
      }
    } catch (error) {
      if (SCHEMA_CODES.has(errorCode(error))) throw new ValuationFailure("SCHEMA_OUT_OF_DATE", "REPLAY", error);
      // Only the replay lookup failed; the valuation itself can still run.
      console.error("[home88:valuation] SNAPSHOT_ERROR: replay lookup failed", errorCode(error));
    }
  }

  let loaded: Awaited<ReturnType<typeof loadCandidates>>;
  try {
    loaded = await loadCandidates(db, subject, referenceDate, config);
  } catch (error) {
    throw new ValuationFailure(SCHEMA_CODES.has(errorCode(error)) ? "SCHEMA_OUT_OF_DATE" : "DATABASE_ERROR", "LOAD_EVIDENCE", error);
  }
  const { candidates, snapshots } = loaded;

  let result: EngineResult;
  try {
    result = runComparableEngine(subject, candidates, { referenceDate, config });
  } catch (error) {
    throw new ValuationFailure("VALUATION_ENGINE_ERROR", "ENGINE", error);
  }
  try {
    const saved = await persist(db, subject, result, snapshots, config, referenceDate, options);
    return { id: saved.id, reference: saved.reference, result, replayed: false };
  } catch (error) {
    if (SCHEMA_CODES.has(errorCode(error))) throw new ValuationFailure("SCHEMA_OUT_OF_DATE", "PERSIST", error);
    console.error(
      `[home88:valuation] SNAPSHOT_ERROR: result not stored (${errorCode(error)}); status=${result.status} type=${subject.propertyType} comparables=${result.comparableCount}`,
    );
    return { id: null, reference: null, result, replayed: false };
  }
}

async function persist(
  db: PrismaClient,
  subject: Subject,
  result: EngineResult,
  snapshots: Map<string, Snapshot>,
  config: EngineConfig,
  referenceDate: Date,
  options: ValuateOptions,
): Promise<{ id: string; reference: string }> {
  const ok = result.status === "OK" ? result : null;
  return db.$transaction(async (tx) => {
    const reference = await nextReference(tx);
    const request = await tx.valuationRequest.create({
      data: {
        reference,
        status: ok ? "COMPLETED" : "INSUFFICIENT_DATA",
        channel: options.channel ?? "WEBSITE",
        propertyType: subject.propertyType,
        region: subject.location.region ?? null,
        city: subject.location.city ?? null,
        areaName: subject.location.area ?? null,
        areaSqm: subject.areaSqm,
        bedrooms: subject.bedrooms ?? null,
        bathrooms: subject.bathrooms ?? null,
        floor: subject.floor ?? null,
        yearBuilt: subject.yearBuilt ?? null,
        condition: subject.condition ?? null,
        features: (subject.features ?? {}) as Prisma.InputJsonValue,
        estimatedMin: ok?.low ?? null,
        estimatedValue: ok?.midpoint ?? null,
        estimatedMax: ok?.high ?? null,
        pricePerSqm: ok?.pricePerSqm ?? null,
        pricePerSqmLow: ok?.pricePerSqmLow ?? null,
        pricePerSqmHigh: ok?.pricePerSqmHigh ?? null,
        confidence: ok?.confidence ?? null,
        comparableCount: result.comparableCount,
        strongComparableCount: ok?.strongComparableCount ?? 0,
        transactionCount: ok?.transactionCount ?? 0,
        askingCount: ok?.askingCount ?? 0,
        scope: result.scope,
        explanation: (ok
          ? { confidenceReasons: ok.confidenceReasons, tierCounts: ok.tierCounts, outliersRemoved: ok.outliersRemoved, sizeRange: ok.sizeRange }
          : result.status === "INSUFFICIENT_DATA"
            ? { reason: result.reason, required: result.required }
            : {}) as Prisma.InputJsonValue,
        engineVersion: result.engineVersion,
        methodologyVersion: result.methodologyVersion,
        config: config as unknown as Prisma.InputJsonValue,
        referenceDate,
        idempotencyKey: options.idempotencyKey ?? null,
      },
      select: { id: true, reference: true },
    });
    if (ok) {
      await tx.valuationRequestComparable.createMany({
        data: ok.comparables.map((c) => {
          const snap = snapshots.get(c.id);
          return {
            requestId: request.id,
            observationRef: c.id,
            propertyId: snap?.propertyId ?? null,
            source: c.source,
            observationType: c.observationType,
            tier: c.tier,
            price: c.price,
            areaSqm: c.areaSqm,
            pricePerSqm: Math.round(c.pricePerSqm * 100) / 100,
            similarity: c.similarity,
            recency: c.recency,
            weight: Math.round(c.weight * 100_000) / 100_000,
            ageMonths: c.ageMonths,
            breakdown: c.breakdown as Prisma.InputJsonValue,
            outlier: c.outlier,
            rank: c.rank,
            snapshot: (snap?.snapshot ?? {}) as Prisma.InputJsonValue,
          };
        }),
      });
    }
    return request;
  });
}

/** Rebuilds the public result from what was stored (used for idempotent replays). */
async function loadStoredResult(db: PrismaClient, id: string): Promise<Omit<StoredValuation, "replayed"> | null> {
  const r = await db.valuationRequest.findUnique({ where: { id } });
  if (!r) return null;
  const explanation = (r.explanation ?? {}) as Record<string, unknown>;
  if (r.status !== "COMPLETED") {
    return {
      id: r.id,
      reference: r.reference,
      result: {
        status: "INSUFFICIENT_DATA", engineVersion: r.engineVersion, methodologyVersion: r.methodologyVersion,
        reason: (explanation.reason as "not_enough_comparables") ?? "not_enough_comparables",
        comparableCount: r.comparableCount, required: Number(explanation.required ?? 0), scope: (r.scope as "AREA") ?? null,
      },
    };
  }
  return {
    id: r.id,
    reference: r.reference,
    result: {
      status: "OK", engineVersion: r.engineVersion, methodologyVersion: r.methodologyVersion,
      midpoint: Number(r.estimatedValue), low: Number(r.estimatedMin), high: Number(r.estimatedMax),
      pricePerSqm: Number(r.pricePerSqm), pricePerSqmLow: Number(r.pricePerSqmLow), pricePerSqmHigh: Number(r.pricePerSqmHigh),
      confidence: r.confidence as "LOW", confidenceReasons: (explanation.confidenceReasons as string[]) ?? [],
      comparableCount: r.comparableCount, strongComparableCount: r.strongComparableCount,
      transactionCount: r.transactionCount, askingCount: r.askingCount, scope: r.scope as "AREA",
      tierCounts: (explanation.tierCounts as { AREA: number; CITY: number; REGION: number }) ?? { AREA: 0, CITY: 0, REGION: 0 },
      outliersRemoved: Number(explanation.outliersRemoved ?? 0),
      sizeRange: (explanation.sizeRange as [number, number]) ?? [0, 0],
      comparables: [],
    },
  };
}

/**
 * What the public may see: the range, the method summary and counts — never a
 * comparable's address, owner, internal id or notes.
 */
export function publicView(result: EngineResult) {
  if (result.status !== "OK") {
    return { status: result.status, comparableCount: result.comparableCount, required: result.required } as const;
  }
  return {
    status: "OK" as const,
    low: result.low,
    midpoint: result.midpoint,
    high: result.high,
    pricePerSqm: result.pricePerSqm,
    pricePerSqmLow: result.pricePerSqmLow,
    pricePerSqmHigh: result.pricePerSqmHigh,
    confidence: result.confidence,
    confidenceReasons: result.confidenceReasons,
    comparableCount: result.comparableCount,
    strongComparableCount: result.strongComparableCount,
    transactionCount: result.transactionCount,
    askingCount: result.askingCount,
    scope: result.scope,
    sizeRange: result.sizeRange,
  };
}
export type PublicValuation = ReturnType<typeof publicView>;
