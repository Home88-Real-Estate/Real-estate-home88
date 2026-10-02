import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import { CHANNEL_LEAD_SOURCES } from "@home88/domain";
import { leadChannelSchema, leadStatusChangeSchema } from "@home88/validation";
import { writeAudit, diffFields } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { db } from "../lib/prisma";
import { allocateReference } from "../lib/references";
import { requireRole } from "../plugins/auth";

const LEAD_STATUSES = [
  "NEW", "CONTACTED", "QUALIFIED", "VIEWING", "OFFER", "WON", "LOST", "NOT_INTERESTED",
] as const;
const LEAD_SOURCES = [
  "WEBSITE", "PROPERTY_ENQUIRY", "PHONE", "WHATSAPP", "EMAIL", "SPITOGATOS", "XE_GR",
  "PORTAL_OTHER", "WALK_IN", "REFERRAL", "SOCIAL", "IMPORT", "OTHER",
] as const;

const listQuerySchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  channel: leadChannelSchema.optional(),
  assignedToId: z.string().min(1).max(40).optional(),
  propertyId: z.string().min(1).max(40).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const createSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(80),
  lastName: z.string().trim().max(80).optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  message: z.string().trim().max(4000).optional().or(z.literal("")),
  source: z.enum(LEAD_SOURCES).default("OTHER"),
  propertyId: z.string().min(1).max(40).optional(),
  assignedToId: z.string().min(1).max(40).optional(),
});

const assignSchema = z.object({
  assignedToId: z.string().min(1).max(40),
  note: z.string().trim().max(2000).optional(),
});

const LIST_SELECT = {
  id: true,
  reference: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  status: true,
  source: true,
  budgetMin: true,
  budgetMax: true,
  lastContactedAt: true,
  nextActionAt: true,
  createdAt: true,
  property: { select: { id: true, reference: true, titleEl: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LeadSelect;

export async function leadRoutes(app: FastifyInstance): Promise<void> {
  app.get("/leads", { preHandler: requireRole("AGENT") }, async (request) => {
    const q = parseInput(listQuerySchema, request.query);
    const where: Prisma.LeadWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.source) where.source = q.source;
    else if (q.channel) {
      where.source = { in: [...CHANNEL_LEAD_SOURCES[q.channel]] as Array<(typeof LEAD_SOURCES)[number]> };
    }
    if (q.assignedToId) where.assignedToId = q.assignedToId;
    if (q.propertyId) where.propertyId = q.propertyId;
    if (q.q) {
      where.OR = [
        { firstName: { contains: q.q, mode: "insensitive" } },
        { lastName: { contains: q.q, mode: "insensitive" } },
        { email: { contains: q.q, mode: "insensitive" } },
        { phone: { contains: q.q } },
        { reference: { contains: q.q.toUpperCase() } },
      ];
    }

    const [total, data] = await db().$transaction([
      db().lead.count({ where }),
      db().lead.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ createdAt: "desc" }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ]);

    return {
      data,
      pagination: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
    };
  });

  app.get("/leads/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    const { id } = request.params as { id: string };
    const lead = await db().lead.findUnique({
      where: { id },
      include: {
        property: { select: { id: true, reference: true, titleEl: true, status: true } },
        contact: { select: { id: true, reference: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        notes: {
          orderBy: { createdAt: "desc" },
          select: { id: true, body: true, isPrivate: true, createdAt: true, author: { select: { id: true, firstName: true, lastName: true } } },
        },
        tasks: { orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, dueAt: true } },
      },
    });
    if (!lead) throw notFound("Lead not found.");
    return { lead };
  });

  app.post("/leads", { preHandler: requireRole("AGENT") }, async (request, reply) => {
    const actor = request.auth!.user;
    const input = parseInput(createSchema, request.body);

    const lead = await db().$transaction(
      async (tx) => {
        const reference = await allocateReference(tx, "lead");
        const created = await tx.lead.create({
          data: {
            reference,
            firstName: input.firstName,
            lastName: input.lastName || null,
            email: input.email || null,
            phone: input.phone || null,
            message: input.message || null,
            source: input.source,
            propertyId: input.propertyId ?? null,
            assignedToId: input.assignedToId ?? actor.id,
          },
        });
        await writeAudit(
          {
            entity: "LEAD",
            entityId: created.id,
            action: "create",
            actorId: actor.id,
            ipAddress: clientIp(request),
            userAgent: userAgent(request),
            changes: { reference, source: input.source },
          },
          tx,
        );
        return created;
      },
      { isolationLevel: "Serializable" },
    );

    reply.code(201);
    return { lead };
  });

  app.patch("/leads/:id/status", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const body = parseInput(leadStatusChangeSchema, request.body);

    const existing = await db().lead.findUnique({ where: { id } });
    if (!existing) throw notFound("Lead not found.");
    if (body.status === "LOST" && !body.lostReason && !existing.lostReason) {
      throw badRequest("A reason is required when marking a lead lost.", { lostReason: ["Required."] });
    }

    const now = new Date();
    const lead = await db().$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: {
          status: body.status,
          lostReason: body.status === "LOST" ? body.lostReason || existing.lostReason : existing.lostReason,
          lastContactedAt: now,
        },
      });
      if (body.note) {
        await tx.note.create({ data: { leadId: id, authorId: actor.id, body: body.note } });
      }
      await writeAudit(
        {
          entity: "LEAD",
          entityId: id,
          action: "status_change",
          actorId: actor.id,
          ipAddress: clientIp(request),
          userAgent: userAgent(request),
          changes: diffFields({ status: existing.status }, { status: body.status }),
        },
        tx,
      );
      return updated;
    });

    return { lead };
  });

  app.post("/leads/:id/assign", { preHandler: requireRole("MANAGER") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const body = parseInput(assignSchema, request.body);

    const [existing, assignee] = await Promise.all([
      db().lead.findUnique({ where: { id } }),
      db().user.findUnique({ where: { id: body.assignedToId } }),
    ]);
    if (!existing) throw notFound("Lead not found.");
    if (!assignee || assignee.status !== "ACTIVE") throw badRequest("Assignee must be an active user.");

    const lead = await db().$transaction(async (tx) => {
      const updated = await tx.lead.update({ where: { id }, data: { assignedToId: assignee.id } });
      if (body.note) {
        await tx.note.create({ data: { leadId: id, authorId: actor.id, body: body.note } });
      }
      await writeAudit(
        {
          entity: "LEAD",
          entityId: id,
          action: "assign",
          actorId: actor.id,
          ipAddress: clientIp(request),
          userAgent: userAgent(request),
          changes: { assignedToId: { from: existing.assignedToId, to: assignee.id } },
        },
        tx,
      );
      return updated;
    });

    return { lead };
  });
}
