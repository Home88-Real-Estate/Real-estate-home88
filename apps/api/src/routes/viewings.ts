/**
 * Viewings (υποδείξεις / ραντεβού) and the calendar.
 *
 * Visibility: managers and above see every agent's; others see their own.
 * Times arrive as agency-local wall clock and are stored as instants.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import { parseLocalDateTime } from "@home88/domain";

import { writeAudit } from "../lib/audit";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { db } from "../lib/prisma";
import { requireRole, roleAtLeast } from "../plugins/auth";

const STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;

const localDateTime = z
  .string()
  .trim()
  .refine((v) => parseLocalDateTime(v) !== null, "Δώστε ημερομηνία και ώρα.")
  .transform((v) => parseLocalDateTime(v)!);

const listSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  scope: z.enum(["mine", "all"]).optional(),
  agentId: z.string().min(1).max(40).optional(),
});

const createSchema = z
  .object({
    propertyReference: z.string().trim().toUpperCase().min(1, "Συμπληρώστε: Κωδικός ακινήτου.").max(20),
    clientName: z.string().trim().min(1, "Συμπληρώστε: Πελάτης.").max(160),
    clientPhone: z.string().trim().max(40).optional().or(z.literal("")),
    clientEmail: z.string().trim().toLowerCase().email("Δώστε έγκυρο email.").max(254).optional().or(z.literal("")),
    startsAt: localDateTime,
    durationMinutes: z.coerce.number().int().min(10).max(600).default(30),
    agentId: z.string().min(1).max(40).optional(),
    leadId: z.string().min(1).max(40).optional(),
  });

const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  startsAt: localDateTime.optional(),
  feedback: z.string().trim().max(4000).optional().or(z.literal("")),
  outcome: z.string().trim().max(400).optional().or(z.literal("")),
});

const SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  clientName: true,
  clientPhone: true,
  clientEmail: true,
  feedback: true,
  outcome: true,
  property: { select: { id: true, reference: true, titleEl: true, areaName: true, city: true } },
  agent: { select: { id: true, firstName: true, lastName: true } },
  lead: { select: { id: true, reference: true } },
} satisfies Prisma.ViewingSelect;

export async function viewingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/viewings", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const q = parseInput(listSchema, request.query);
    if (q.to <= q.from || q.to.getTime() - q.from.getTime() > 62 * 86_400_000) {
      throw badRequest("Μη έγκυρο διάστημα ημερομηνιών.");
    }
    const manager = roleAtLeast(actor.role, "MANAGER");
    const all = (q.scope ?? (manager ? "all" : "mine")) === "all" && manager;
    const where: Prisma.ViewingWhereInput = {
      startsAt: { gte: q.from, lt: q.to },
      ...(all ? (q.agentId ? { agentId: q.agentId } : {}) : { agentId: actor.id }),
    };
    const data = await db().viewing.findMany({ where, select: SELECT, orderBy: { startsAt: "asc" }, take: 500 });
    return { data, scope: all ? "all" : "mine" };
  });

  app.post("/viewings", { preHandler: requireRole("AGENT") }, async (request, reply) => {
    const actor = request.auth!.user;
    const input = parseInput(createSchema, request.body);

    const property = await db().property.findUnique({
      where: { reference: input.propertyReference },
      select: { id: true, status: true },
    });
    if (!property) {
      throw badRequest("Δεν βρέθηκε ακίνητο με αυτόν τον κωδικό.", { propertyReference: ["Άγνωστος κωδικός ακινήτου."] });
    }
    if (property.status === "ARCHIVED") {
      throw badRequest("Το ακίνητο είναι αρχειοθετημένο.", { propertyReference: ["Το ακίνητο είναι αρχειοθετημένο."] });
    }

    const agentId = input.agentId ?? actor.id;
    if (agentId !== actor.id && !roleAtLeast(actor.role, "MANAGER")) {
      throw forbidden("Μόνο ένας υπεύθυνος μπορεί να ορίσει ραντεβού για άλλον σύμβουλο.");
    }

    const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
    // Same agent, overlapping time: refuse rather than double-book.
    const clash = await db().viewing.findFirst({
      where: { agentId, status: "SCHEDULED", startsAt: { lt: endsAt }, endsAt: { gt: input.startsAt } },
      select: { id: true },
    });
    if (clash) {
      throw badRequest("Ο σύμβουλος έχει ήδη ραντεβού εκείνη την ώρα.", { startsAt: ["Υπάρχει άλλο ραντεβού την ίδια ώρα."] });
    }

    const viewing = await db().viewing.create({
      data: {
        propertyId: property.id,
        clientName: input.clientName,
        clientPhone: input.clientPhone || null,
        clientEmail: input.clientEmail || null,
        startsAt: input.startsAt,
        endsAt,
        agentId,
        leadId: input.leadId ?? null,
      },
      select: SELECT,
    });
    await writeAudit({
      entity: "VIEWING",
      entityId: viewing.id,
      action: "create",
      actorId: actor.id,
      ipAddress: clientIp(request),
      userAgent: userAgent(request),
    });
    reply.code(201);
    return { viewing };
  });

  app.patch("/viewings/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const input = parseInput(updateSchema, request.body);

    const existing = await db().viewing.findUnique({ where: { id }, select: { agentId: true, startsAt: true, endsAt: true } });
    if (!existing) throw notFound("Το ραντεβού δεν βρέθηκε.");
    if (existing.agentId !== actor.id && !roleAtLeast(actor.role, "MANAGER")) {
      throw forbidden("Δεν έχετε πρόσβαση σε αυτό το ραντεβού.");
    }

    let timing: { startsAt?: Date; endsAt?: Date } = {};
    if (input.startsAt) {
      const length = existing.endsAt ? existing.endsAt.getTime() - existing.startsAt.getTime() : 30 * 60_000;
      timing = { startsAt: input.startsAt, endsAt: new Date(input.startsAt.getTime() + length) };
    }

    const viewing = await db().viewing.update({
      where: { id },
      data: {
        ...timing,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.feedback !== undefined ? { feedback: input.feedback || null } : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome || null } : {}),
      },
      select: SELECT,
    });
    await writeAudit({
      entity: "VIEWING",
      entityId: id,
      action: input.status ? `status:${input.status}` : "update",
      actorId: actor.id,
      ipAddress: clientIp(request),
      userAgent: userAgent(request),
    });
    return { viewing };
  });
}
