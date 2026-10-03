/**
 * Reminders (tasks): what each person has to do and by when.
 *
 * Visibility: managers and above see everyone's; others see the ones assigned
 * to them or created by them. Due times arrive as agency-local wall clock
 * ("2026-10-05T10:30") and are stored as instants.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import { localDay, parseLocalDateTime } from "@home88/domain";

import { writeAudit } from "../lib/audit";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { db } from "../lib/prisma";
import { requireRole, roleAtLeast } from "../plugins/auth";

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;

const localDateTime = z
  .string()
  .trim()
  .refine((v) => parseLocalDateTime(v) !== null, "Δώστε ημερομηνία και ώρα.")
  .transform((v) => parseLocalDateTime(v)!);

const listSchema = z.object({
  bucket: z.enum(["overdue", "today", "upcoming", "nodate", "done"]).default("today"),
  scope: z.enum(["mine", "all"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createSchema = z.object({
  title: z.string().trim().min(1, "Συμπληρώστε: Τίτλος.").max(200),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  dueAt: localDateTime.optional(),
  assignedToId: z.string().min(1).max(40).optional(),
  leadId: z.string().min(1).max(40).optional(),
  propertyId: z.string().min(1).max(40).optional(),
});

const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueAt: localDateTime.optional().nullable(),
});

const SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
  createdById: true,
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  lead: { select: { id: true, reference: true, firstName: true, lastName: true } },
  property: { select: { id: true, reference: true, titleEl: true } },
} satisfies Prisma.TaskSelect;

function visibleTo(actor: { id: string; role: string }, all: boolean): Prisma.TaskWhereInput {
  if (all && roleAtLeast(actor.role, "MANAGER")) return {};
  return { OR: [{ assignedToId: actor.id }, { createdById: actor.id }] };
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tasks", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const q = parseInput(listSchema, request.query);
    const all = (q.scope ?? (roleAtLeast(actor.role, "MANAGER") ? "all" : "mine")) === "all";
    const today = localDay(new Date());
    const open: Prisma.TaskWhereInput = { status: { in: ["OPEN", "IN_PROGRESS"] } };

    const buckets: Record<typeof q.bucket, Prisma.TaskWhereInput> = {
      overdue: { ...open, dueAt: { lt: new Date() } },
      today: { ...open, dueAt: { gte: new Date(), lt: today.to } },
      upcoming: { ...open, dueAt: { gte: today.to } },
      nodate: { ...open, dueAt: null },
      done: { status: { in: ["DONE", "CANCELLED"] } },
    };
    const where: Prisma.TaskWhereInput = { AND: [visibleTo(actor, all), buckets[q.bucket]] };
    const scopeWhere = visibleTo(actor, all);

    const [total, data, counts] = await Promise.all([
      db().task.count({ where }),
      db().task.findMany({
        where,
        select: SELECT,
        orderBy: q.bucket === "done" ? [{ completedAt: "desc" }, { updatedAt: "desc" }] : [{ dueAt: "asc" }, { createdAt: "asc" }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      Promise.all(
        (Object.keys(buckets) as Array<keyof typeof buckets>).map(async (key) => [
          key,
          await db().task.count({ where: { AND: [scopeWhere, buckets[key]] } }),
        ] as const),
      ),
    ]);

    return {
      data,
      counts: Object.fromEntries(counts),
      scope: all ? "all" : "mine",
      pagination: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
    };
  });

  app.post("/tasks", { preHandler: requireRole("AGENT") }, async (request, reply) => {
    const actor = request.auth!.user;
    const input = parseInput(createSchema, request.body);

    // Only managers assign reminders to someone else.
    const assignee = input.assignedToId ?? actor.id;
    if (assignee !== actor.id && !roleAtLeast(actor.role, "MANAGER")) {
      throw forbidden("Μόνο ένας υπεύθυνος μπορεί να αναθέσει υπενθύμιση σε άλλον.");
    }
    if (assignee !== actor.id) {
      const user = await db().user.findUnique({ where: { id: assignee }, select: { status: true } });
      if (!user || user.status !== "ACTIVE") throw badRequest("Η ανάθεση πρέπει να γίνει σε ενεργό χρήστη.");
    }

    const task = await db().task.create({
      data: {
        title: input.title,
        description: input.description || null,
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        assignedToId: assignee,
        leadId: input.leadId ?? null,
        propertyId: input.propertyId ?? null,
        createdById: actor.id,
      },
      select: SELECT,
    });
    await writeAudit({
      entity: "TASK",
      entityId: task.id,
      action: "create",
      actorId: actor.id,
      ipAddress: clientIp(request),
      userAgent: userAgent(request),
    });
    reply.code(201);
    return { task };
  });

  app.patch("/tasks/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const input = parseInput(updateSchema, request.body);

    const existing = await db().task.findUnique({ where: { id }, select: { assignedToId: true, createdById: true, status: true } });
    if (!existing) throw notFound("Η υπενθύμιση δεν βρέθηκε.");
    const mine = existing.assignedToId === actor.id || existing.createdById === actor.id;
    if (!mine && !roleAtLeast(actor.role, "MANAGER")) throw forbidden("Δεν έχετε πρόσβαση σε αυτή την υπενθύμιση.");

    const closing = input.status === "DONE" || input.status === "CANCELLED";
    const task = await db().task.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
        ...(input.status !== undefined ? { status: input.status, completedAt: closing ? new Date() : null } : {}),
      },
      select: SELECT,
    });
    await writeAudit({
      entity: "TASK",
      entityId: id,
      action: input.status ? `status:${input.status}` : "update",
      actorId: actor.id,
      ipAddress: clientIp(request),
      userAgent: userAgent(request),
    });
    return { task };
  });
}
