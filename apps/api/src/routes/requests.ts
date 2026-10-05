/**
 * Buyer/tenant requests (Ζητήσεις) and matching.
 *
 * A request states what a client wants; matching scores properties against
 * it with the deterministic rules in @home88/domain (request-matching), and
 * the reverse: which requests a property suits.
 *
 * Visibility: managers and above see all requests; others see the ones
 * assigned to them or created by them.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import {
  MATCHABLE_STATUSES,
  REQUEST_FEATURES,
  scoreMatch,
} from "@home88/domain";

import { writeAudit } from "../lib/audit";
import { forbidden, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { db } from "../lib/prisma";
import { allocateReference } from "../lib/references";
import { requestConfig } from "../settings";
import { requireRole, roleAtLeast } from "../plugins/auth";
import { notify } from "../lib/notify";
import { PROPERTY_MATCH_SELECT, n, toMatchProperty, toMatchRequest, type PropertyRow } from "../lib/matching";

const LISTING_TYPES = ["SALE", "RENT", "ASSIGNMENT"] as const;
const PROPERTY_TYPES = [
  "APARTMENT", "MAISONETTE", "HOUSE", "VILLA", "STUDIO", "OFFICE", "SHOP", "WAREHOUSE", "BUILDING", "HOTEL",
  "LAND", "PLOT", "PARKING", "INDUSTRIAL", "OTHER",
] as const;
const STATUSES = ["ACTIVE", "PAUSED", "FULFILLED", "CANCELLED"] as const;

const optionalNumber = (max: number) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? (v.trim() === "" ? null : Number(v.replace(/[\s.]/g, "").replace(",", "."))) : v))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= max), "Δώστε έναν έγκυρο αριθμό.")
    .optional()
    .nullable();

const optionalInt = (min: number, max: number) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? (v.trim() === "" ? null : Number(v)) : v))
    .refine((v) => v === null || (Number.isInteger(v) && v >= min && v <= max), "Δώστε έναν ακέραιο αριθμό.")
    .optional()
    .nullable();

const bodySchema = z
  .object({
    listingType: z.enum(LISTING_TYPES),
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(15).default([]),
    areas: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    minPrice: optionalNumber(1_000_000_000),
    maxPrice: optionalNumber(1_000_000_000),
    minArea: optionalNumber(10_000_000),
    maxArea: optionalNumber(10_000_000),
    minBedrooms: optionalInt(0, 50),
    minBathrooms: optionalInt(0, 50),
    minFloor: optionalInt(-5, 200),
    minYearBuilt: optionalInt(1800, 2100),
    features: z.array(z.enum(REQUEST_FEATURES)).max(20).default([]),
    clientName: z.string().trim().min(1, "Συμπληρώστε: Πελάτης.").max(160),
    clientPhone: z.string().trim().max(40).optional().or(z.literal("")),
    clientEmail: z.string().trim().toLowerCase().email("Δώστε έγκυρο email.").max(254).optional().or(z.literal("")),
    rating: optionalInt(1, 5),
    notes: z.string().trim().max(4000).optional().or(z.literal("")),
    expiresAt: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Δώστε ημερομηνία.")
      .optional()
      .or(z.literal("")),
    assignedToId: z.string().min(1).max(40).optional(),
    status: z.enum(STATUSES).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.minPrice != null && v.maxPrice != null && v.minPrice > v.maxPrice) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxPrice"], message: "Η μέγιστη τιμή είναι μικρότερη από την ελάχιστη." });
    }
    if (v.minArea != null && v.maxArea != null && v.minArea > v.maxArea) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxArea"], message: "Το μέγιστο εμβαδόν είναι μικρότερο από το ελάχιστο." });
    }
  });

const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  listingType: z.enum(LISTING_TYPES).optional(),
  q: z.string().trim().max(120).optional(),
  scope: z.enum(["mine", "all"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function visibleTo(actor: { id: string; role: string }, all: boolean): Prisma.BuyerRequestWhereInput {
  if (all && roleAtLeast(actor.role, "MANAGER")) return {};
  return { OR: [{ assignedToId: actor.id }, { createdById: actor.id }] };
}

function canSee(actor: { id: string; role: string }, r: { assignedToId: string | null; createdById: string | null }) {
  return roleAtLeast(actor.role, "MANAGER") || r.assignedToId === actor.id || r.createdById === actor.id;
}

function toData(input: z.infer<typeof bodySchema>) {
  return {
    listingType: input.listingType,
    propertyTypes: input.propertyTypes,
    areas: [...new Set(input.areas)],
    minPrice: input.minPrice ?? null,
    maxPrice: input.maxPrice ?? null,
    minArea: input.minArea ?? null,
    maxArea: input.maxArea ?? null,
    minBedrooms: input.minBedrooms ?? null,
    minBathrooms: input.minBathrooms ?? null,
    minFloor: input.minFloor ?? null,
    minYearBuilt: input.minYearBuilt ?? null,
    features: [...new Set(input.features)],
    clientName: input.clientName,
    clientPhone: input.clientPhone || null,
    clientEmail: input.clientEmail || null,
    rating: input.rating ?? null,
    notes: input.notes || null,
    expiresAt: input.expiresAt ? new Date(`${input.expiresAt}T23:59:59Z`) : null,
  };
}

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  app.get("/requests", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const q = parseInput(listSchema, request.query);
    const all = (q.scope ?? (roleAtLeast(actor.role, "MANAGER") ? "all" : "mine")) === "all";
    const and: Prisma.BuyerRequestWhereInput[] = [visibleTo(actor, all)];
    if (q.status) and.push({ status: q.status });
    if (q.listingType) and.push({ listingType: q.listingType });
    if (q.q) {
      and.push({
        OR: [
          { clientName: { contains: q.q, mode: "insensitive" } },
          { clientPhone: { contains: q.q } },
          { clientEmail: { contains: q.q, mode: "insensitive" } },
          { reference: { contains: q.q.toUpperCase() } },
        ],
      });
    }
    const where = { AND: and };
    const [total, data] = await Promise.all([
      db().buyerRequest.count({ where }),
      db().buyerRequest.findMany({
        where,
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: [{ createdAt: "desc" }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ]);
    return {
      data,
      scope: all ? "all" : "mine",
      pagination: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
    };
  });

  app.post("/requests", { preHandler: requireRole("AGENT") }, async (request, reply) => {
    const actor = request.auth!.user;
    const input = parseInput(bodySchema, request.body);
    const assignee = input.assignedToId ?? actor.id;
    if (assignee !== actor.id && !roleAtLeast(actor.role, "MANAGER")) {
      throw forbidden("Μόνο ένας υπεύθυνος μπορεί να αναθέσει ζήτηση σε άλλον.");
    }

    const created = await db().$transaction(
      async (tx) => {
        const reference = await allocateReference(tx, "request", "ZHT");
        const row = await tx.buyerRequest.create({
          data: { ...toData(input), reference, assignedToId: assignee, createdById: actor.id },
        });
        await writeAudit(
          {
            entity: "REQUEST",
            entityId: row.id,
            action: "create",
            actorId: actor.id,
            ipAddress: clientIp(request),
            userAgent: userAgent(request),
            changes: { reference, listingType: input.listingType },
          },
          tx,
        );
        return row;
      },
      { isolationLevel: "Serializable" },
    );
    if (created.assignedToId && created.assignedToId !== actor.id) {
      await notify({ event: "REQUEST_NEW", title: `Νέα ζήτηση ${created.reference}`, entityType: "REQUEST", entityId: created.id, userIds: [created.assignedToId], link: `/requests/${created.id}` });
    }
    reply.code(201);
    return { request: created };
  });

  app.get("/requests/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const row = await db().buyerRequest.findUnique({
      where: { id },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!row || !canSee(actor, row)) throw notFound("Η ζήτηση δεν βρέθηκε.");

    // Hard rules in the query; scoring in code. Bounded so a large inventory
    // never loads in full.
    const candidates = await db().property.findMany({
      where: {
        status: { in: [...MATCHABLE_STATUSES] },
        listingType: row.listingType,
        ...(row.propertyTypes.length > 0 ? { propertyType: { in: row.propertyTypes } } : {}),
      },
      select: PROPERTY_MATCH_SELECT,
      orderBy: { updatedAt: "desc" },
      take: 1000,
    });
    const want = toMatchRequest(row);
    const rules = await requestConfig();
    const matches = candidates
      .map((p) => ({ p, result: scoreMatch(want, toMatchProperty(p), rules) }))
      .filter((m): m is { p: PropertyRow; result: NonNullable<typeof m.result> } => m.result !== null && m.result.score >= rules.minMatchScore)
      .sort((a, b) => b.result.score - a.result.score)
      .slice(0, rules.maxMatches)
      .map(({ p, result }) => ({
        property: {
          id: p.id,
          reference: p.reference,
          titleEl: p.titleEl,
          propertyType: p.propertyType,
          price: n(p.price),
          monthlyRent: n(p.monthlyRent),
          priceOnRequest: p.priceOnRequest,
          area: n(p.area),
          bedrooms: p.bedrooms,
          areaName: p.areaName,
          city: p.city,
        },
        ...result,
      }));

    return { request: row, matches, candidates: candidates.length };
  });

  app.patch("/requests/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const existing = await db().buyerRequest.findUnique({ where: { id } });
    if (!existing || !canSee(actor, existing)) throw notFound("Η ζήτηση δεν βρέθηκε.");

    const body = (request.body ?? {}) as Record<string, unknown>;
    // Status-only change (pause, fulfil, cancel, reactivate).
    if (Object.keys(body).length === 1 && "status" in body) {
      const { status } = parseInput(z.object({ status: z.enum(STATUSES) }), body);
      const updated = await db().buyerRequest.update({ where: { id }, data: { status } });
      await writeAudit({
        entity: "REQUEST",
        entityId: id,
        action: `status:${status}`,
        actorId: actor.id,
        ipAddress: clientIp(request),
        userAgent: userAgent(request),
      });
      return { request: updated };
    }

    const input = parseInput(bodySchema, body);
    const updated = await db().buyerRequest.update({
      where: { id },
      data: { ...toData(input), ...(input.status ? { status: input.status } : {}) },
    });
    await writeAudit({
      entity: "REQUEST",
      entityId: id,
      action: "update",
      actorId: actor.id,
      ipAddress: clientIp(request),
      userAgent: userAgent(request),
    });
    return { request: updated };
  });

  /** Reverse matching: which active requests this property suits. */
  app.get("/properties/:id/matching-requests", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const property = await db().property.findUnique({ where: { id }, select: PROPERTY_MATCH_SELECT });
    if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");

    const all = roleAtLeast(actor.role, "MANAGER");
    const requests = await db().buyerRequest.findMany({
      where: { AND: [visibleTo(actor, all), { status: "ACTIVE", listingType: property.listingType }] },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const target = toMatchProperty({ ...property, status: "ACTIVE" });
    const rules = await requestConfig();
    const matches = requests
      .map((r) => ({ r, result: scoreMatch(toMatchRequest(r), target, rules) }))
      .filter((m) => m.result !== null && m.result.score >= rules.minMatchScore)
      .sort((a, b) => b.result!.score - a.result!.score)
      .slice(0, rules.maxMatches)
      .map(({ r, result }) => ({
        request: { id: r.id, reference: r.reference, clientName: r.clientName, rating: r.rating },
        ...result!,
      }));
    return { matches };
  });
}
