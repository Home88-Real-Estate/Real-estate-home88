import type { FastifyInstance } from "fastify";
import type { Prisma } from "@home88/database";
import {
  propertySearchSchema,
  propertyUpdateSchema,
  propertyUpsertSchema,
  type PropertySearchInput,
  type PropertyUpsertInput,
} from "@home88/validation";
import { writeAudit, diffFields } from "../lib/audit";
import { notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { db } from "../lib/prisma";
import { allocateReference, slugify } from "../lib/references";
import { requireRole } from "../plugins/auth";

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function nullableString(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

/** Validated input mapped onto scalar columns (relations and keys are added by the caller). */
function toScalars(input: PropertyUpsertInput): Omit<Prisma.PropertyUncheckedCreateInput, "reference" | "slug"> {
  return {
    listingType: input.listingType,
    propertyType: input.propertyType,
    status: input.status,
    condition: input.condition,
    titleEl: input.titleEl,
    titleEn: nullableString(input.titleEn),
    descriptionEl: input.descriptionEl,
    descriptionEn: nullableString(input.descriptionEn),
    price: input.price ?? null,
    priceOnRequest: input.priceOnRequest,
    monthlyRent: input.monthlyRent ?? null,
    area: input.area ?? null,
    plotArea: input.plotArea ?? null,
    builtArea: input.builtArea ?? null,
    bedrooms: input.bedrooms ?? null,
    bathrooms: input.bathrooms ?? null,
    wc: input.wc ?? null,
    floor: input.floor ?? null,
    totalFloors: input.totalFloors ?? null,
    yearBuilt: input.yearBuilt ?? null,
    yearRenovated: input.yearRenovated ?? null,
    heating: input.heating,
    energyClass: input.energyClass,
    hasSolar: input.hasSolar,
    parking: input.parking,
    parkingSpaces: input.parkingSpaces ?? null,
    storage: input.storage,
    balcony: input.balcony,
    balconyArea: input.balconyArea ?? null,
    garden: input.garden,
    pool: input.pool,
    furnished: input.furnished,
    petsAllowed: input.petsAllowed,
    seaView: input.seaView,
    newConstruction: input.newConstruction,
    region: nullableString(input.region),
    city: nullableString(input.city),
    areaName: nullableString(input.areaName),
    neighborhood: nullableString(input.neighborhood),
    address: nullableString(input.address),
    postalCode: nullableString(input.postalCode),
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    videoUrl: nullableString(input.videoUrl),
    virtualTourUrl: nullableString(input.virtualTourUrl),
    publishedOnWebsite: input.publishedOnWebsite,
    featured: input.featured,
    commissionRatePct: input.commissionRatePct ?? null,
    agentCommissionPct: input.agentCommissionPct ?? null,
  };
}

/**
 * Projects a row (or a validated input) into a comparable, normalised shape.
 * Used to validate a PATCH as the state it produces, and to diff before/after
 * without a second database read.
 */
function toComparable(e: Record<string, unknown>): Record<string, unknown> {
  return {
    listingType: e.listingType,
    propertyType: e.propertyType,
    status: e.status,
    condition: e.condition,
    titleEl: e.titleEl,
    titleEn: strOrUndef(e.titleEn),
    descriptionEl: e.descriptionEl,
    descriptionEn: strOrUndef(e.descriptionEn),
    price: num(e.price),
    priceOnRequest: e.priceOnRequest,
    monthlyRent: num(e.monthlyRent),
    area: num(e.area),
    plotArea: num(e.plotArea),
    builtArea: num(e.builtArea),
    bedrooms: e.bedrooms,
    bathrooms: e.bathrooms,
    wc: e.wc,
    floor: e.floor,
    totalFloors: e.totalFloors,
    yearBuilt: e.yearBuilt,
    yearRenovated: e.yearRenovated,
    heating: e.heating,
    energyClass: e.energyClass,
    hasSolar: e.hasSolar,
    parking: e.parking,
    parkingSpaces: e.parkingSpaces,
    storage: e.storage,
    balcony: e.balcony,
    balconyArea: num(e.balconyArea),
    garden: e.garden,
    pool: e.pool,
    furnished: e.furnished,
    petsAllowed: e.petsAllowed,
    seaView: e.seaView,
    newConstruction: e.newConstruction,
    region: strOrUndef(e.region),
    city: strOrUndef(e.city),
    areaName: strOrUndef(e.areaName),
    neighborhood: strOrUndef(e.neighborhood),
    address: strOrUndef(e.address),
    postalCode: strOrUndef(e.postalCode),
    latitude: num(e.latitude),
    longitude: num(e.longitude),
    videoUrl: strOrUndef(e.videoUrl),
    virtualTourUrl: strOrUndef(e.virtualTourUrl),
    publishedOnWebsite: e.publishedOnWebsite,
    featured: e.featured,
    agentId: e.agentId ?? undefined,
    ownerId: e.ownerId ?? undefined,
    commissionRatePct: num(e.commissionRatePct),
    agentCommissionPct: num(e.agentCommissionPct),
  };
}

function withoutUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function orderBy(sort: PropertySearchInput["sort"]): Prisma.PropertyOrderByWithRelationInput {
  switch (sort) {
    case "price_asc":
      return { price: "asc" };
    case "price_desc":
      return { price: "desc" };
    case "area_desc":
      return { area: "desc" };
    case "area_asc":
      return { area: "asc" };
    default:
      return { createdAt: "desc" };
  }
}

const LIST_SELECT = {
  id: true,
  reference: true,
  slug: true,
  listingType: true,
  propertyType: true,
  status: true,
  titleEl: true,
  price: true,
  priceOnRequest: true,
  area: true,
  bedrooms: true,
  bathrooms: true,
  city: true,
  neighborhood: true,
  publishedOnWebsite: true,
  featured: true,
  createdAt: true,
  updatedAt: true,
  agent: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { media: true, leads: true } },
} satisfies Prisma.PropertySelect;

export async function propertyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/properties", { preHandler: requireRole("AGENT") }, async (request) => {
    const q = parseInput(propertySearchSchema, request.query);
    const where: Prisma.PropertyWhereInput = {};
    if (q.listingType) where.listingType = q.listingType;
    if (q.propertyType) where.propertyType = q.propertyType;
    if (q.status) where.status = q.status;
    if (q.city) where.city = { contains: q.city, mode: "insensitive" };
    if (q.neighborhood) where.neighborhood = { contains: q.neighborhood, mode: "insensitive" };
    if (q.region) where.region = { contains: q.region, mode: "insensitive" };
    if (q.minPrice != null || q.maxPrice != null) {
      where.price = {
        ...(q.minPrice != null ? { gte: q.minPrice } : {}),
        ...(q.maxPrice != null ? { lte: q.maxPrice } : {}),
      };
    }
    if (q.bedrooms != null) where.bedrooms = { gte: q.bedrooms };
    if (q.q) {
      where.OR = [
        { titleEl: { contains: q.q, mode: "insensitive" } },
        { reference: { contains: q.q.toUpperCase() } },
        { city: { contains: q.q, mode: "insensitive" } },
      ];
    }

    const [total, data] = await db().$transaction([
      db().property.count({ where }),
      db().property.findMany({
        where,
        select: LIST_SELECT,
        orderBy: orderBy(q.sort),
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ]);

    return {
      data,
      pagination: {
        page: q.page,
        limit: q.limit,
        total,
        pages: Math.max(1, Math.ceil(total / q.limit)),
      },
    };
  });

  app.get("/properties/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    const { id } = request.params as { id: string };
    const property = await db().property.findUnique({
      where: { id },
      include: {
        media: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        agent: { select: { id: true, firstName: true, lastName: true } },
        // Owner PII columns (emailEncrypted etc.) are deliberately not selected.
        owner: { select: { id: true, reference: true, firstName: true, lastName: true } },
        portalListings: {
          select: {
            id: true,
            state: true,
            externalUrl: true,
            lastSyncedAt: true,
            portal: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });
    if (!property) throw notFound("Property not found.");
    return { property };
  });

  app.post("/properties", { preHandler: requireRole("AGENT") }, async (request, reply) => {
    const actor = request.auth!.user;
    const input = parseInput(propertyUpsertSchema, request.body);

    const property = await db().$transaction(
      async (tx) => {
        const reference = input.reference ?? (await allocateReference(tx, "property"));
        const slug = slugify(input.titleEl, reference);
        const created = await tx.property.create({
          data: {
            ...toScalars(input),
            reference,
            slug,
            agentId: input.agentId ?? null,
            ownerId: input.ownerId ?? null,
            createdById: actor.id,
            publishedAt: input.publishedOnWebsite ? new Date() : null,
          },
        });
        await writeAudit(
          {
            entity: "PROPERTY",
            entityId: created.id,
            action: "create",
            actorId: actor.id,
            ipAddress: clientIp(request),
            userAgent: userAgent(request),
            changes: { reference, titleEl: input.titleEl, status: input.status },
          },
          tx,
        );
        return created;
      },
      { isolationLevel: "Serializable" },
    );

    reply.code(201);
    return { property };
  });

  app.patch("/properties/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };

    const existing = await db().property.findUnique({ where: { id } });
    if (!existing) throw notFound("Property not found.");

    const patch = parseInput(propertyUpdateSchema, request.body) as Record<string, unknown>;
    const before = toComparable(existing as unknown as Record<string, unknown>);
    const merged = { ...before, ...withoutUndefined(patch) };
    const input = parseInput(propertyUpsertSchema, merged);
    const after = toComparable(input as unknown as Record<string, unknown>);

    const now = new Date();
    const property = await db().$transaction(
      async (tx) => {
        const updated = await tx.property.update({
          where: { id },
          data: {
            ...toScalars(input),
            agentId: input.agentId ?? null,
            ownerId: input.ownerId ?? null,
            publishedAt:
              input.publishedOnWebsite && existing.publishedAt == null ? now : existing.publishedAt,
          },
        });
        await writeAudit(
          {
            entity: "PROPERTY",
            entityId: id,
            action: "update",
            actorId: actor.id,
            ipAddress: clientIp(request),
            userAgent: userAgent(request),
            changes: diffFields(before, after),
          },
          tx,
        );
        return updated;
      },
      { isolationLevel: "Serializable" },
    );

    return { property };
  });

  app.delete("/properties/:id", { preHandler: requireRole("ADMIN") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };

    const existing = await db().property.findUnique({ where: { id } });
    if (!existing) throw notFound("Property not found.");

    // Archive rather than delete: leads, offers and viewings reference the row.
    const property = await db().$transaction(async (tx) => {
      const updated = await tx.property.update({
        where: { id },
        data: { status: "ARCHIVED", publishedOnWebsite: false },
      });
      await writeAudit(
        {
          entity: "PROPERTY",
          entityId: id,
          action: "archive",
          actorId: actor.id,
          ipAddress: clientIp(request),
          userAgent: userAgent(request),
          changes: { status: { from: existing.status, to: "ARCHIVED" } },
        },
        tx,
      );
      return updated;
    });

    return { property };
  });
}
