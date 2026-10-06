/**
 * Staff accounts.
 *
 * Authorisation here is hierarchical and explicit: an admin can only act on a
 * role strictly below their own, so an ADMIN cannot mint another ADMIN (or a
 * SUPER_ADMIN), and nobody can edit their own role or status. The last active
 * super admin can never be demoted or suspended out of existence.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import {
  USER_ROLES,
  USER_STATUSES,
  userCreateSchema,
  userPasswordSchema,
  userUpdateSchema,
} from "@home88/validation";
import { loadConfig } from "../config";
import { diffFields, writeAudit } from "../lib/audit";
import { HttpError, badRequest, forbidden, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { hashPassword } from "../lib/passwords";
import { db } from "../lib/prisma";
import { revokeAllUserSessions } from "../lib/sessions";
import { ROLE_RANK, requireRole } from "../plugins/auth";

const listQuerySchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  status: true,
  locale: true,
  avatarUrl: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type UserRecord = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  status: string;
  locale: string;
  avatarUrl: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    status: user.status,
    locale: user.locale,
    avatarUrl: user.avatarUrl,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/** Strictly greater: peers cannot manage each other, which prevents admin wars. */
function canManageRole(actorRole: string, targetRole: string): boolean {
  return (ROLE_RANK[actorRole] ?? -1) > (ROLE_RANK[targetRole] ?? Number.POSITIVE_INFINITY);
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Names only, for choosing who looks after a contact or showing. No email, role or status detail.
  app.get("/users/directory", { preHandler: requireRole("AGENT") }, async () => {
    const rows = await db().user.findMany({ where: { status: "ACTIVE" }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, firstName: true, lastName: true } });
    return { data: rows.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() })) };
  });

  app.get("/users", { preHandler: requireRole("MANAGER") }, async (request) => {
    const q = parseInput(listQuerySchema, request.query);
    const where: Prisma.UserWhereInput = {};
    if (q.role) where.role = q.role;
    if (q.status) where.status = q.status;
    if (q.q) {
      where.OR = [
        { firstName: { contains: q.q, mode: "insensitive" } },
        { lastName: { contains: q.q, mode: "insensitive" } },
        { email: { contains: q.q, mode: "insensitive" } },
        { phone: { contains: q.q } },
      ];
    }

    const [total, rows] = await db().$transaction([
      db().user.count({ where }),
      db().user.findMany({
        where,
        select: USER_SELECT,
        orderBy: [{ role: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ]);

    return {
      data: rows.map(toDto),
      pagination: {
        page: q.page,
        limit: q.limit,
        total,
        pages: Math.max(1, Math.ceil(total / q.limit)),
      },
    };
  });

  app.get("/users/:id", { preHandler: requireRole("MANAGER") }, async (request) => {
    const { id } = request.params as { id: string };
    const user = await db().user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw notFound("Ο χρήστης δεν βρέθηκε.");
    return { user: toDto(user) };
  });

  app.post("/users", { preHandler: requireRole("ADMIN") }, async (request, reply) => {
    const actor = request.auth!.user;
    const cfg = loadConfig();
    const input = parseInput(userCreateSchema, request.body);

    if (!canManageRole(actor.role, input.role)) {
      throw forbidden("Δεν μπορείτε να δημιουργήσετε χρήστη με αυτόν τον ρόλο.");
    }
    const existing = await db().user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new HttpError(409, "email_taken", "A user with this email already exists.");
    }

    const user = await db().$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          passwordHash: hashPassword(input.password, cfg.PASSWORD_HASH_ROUNDS),
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone || null,
          role: input.role,
          status: "ACTIVE",
          createdById: actor.id,
        },
        select: USER_SELECT,
      });

      await writeAudit(
        {
          entity: "USER",
          entityId: created.id,
          action: "create",
          actorId: actor.id,
          ipAddress: clientIp(request),
          userAgent: userAgent(request),
          changes: { email: created.email, role: created.role },
        },
        tx,
      );

      return created;
    });

    reply.code(201);
    return { user: toDto(user) };
  });

  app.patch("/users/:id", { preHandler: requireRole("ADMIN") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const input = parseInput(userUpdateSchema, request.body);

    const existing = await db().user.findUnique({ where: { id } });
    if (!existing) throw notFound("Ο χρήστης δεν βρέθηκε.");

    const isSelf = actor.id === id;
    if (!isSelf && !canManageRole(actor.role, existing.role)) {
      throw forbidden("Δεν μπορείτε να διαχειριστείτε αυτόν τον χρήστη.");
    }
    if (input.role !== undefined && !canManageRole(actor.role, input.role)) {
      throw forbidden("Δεν μπορείτε να αναθέσετε αυτόν τον ρόλο.");
    }
    if (isSelf && (input.role !== undefined || (input.status !== undefined && input.status !== existing.status))) {
      throw forbidden("Δεν μπορείτε να αλλάξετε τον δικό σας ρόλο ή κατάσταση.");
    }

    const losingSuperAdmin =
      existing.role === "SUPER_ADMIN" &&
      ((input.role !== undefined && input.role !== "SUPER_ADMIN") ||
        (input.status !== undefined && input.status !== "ACTIVE"));
    if (losingSuperAdmin) {
      const remaining = await db().user.count({
        where: { role: "SUPER_ADMIN", status: "ACTIVE", NOT: { id } },
      });
      if (remaining === 0) throw badRequest("Χρειάζεται τουλάχιστον ένας ενεργός διαχειριστής συστήματος.");
    }

    const nextStatus = input.status ?? existing.status;
    const becomesSuspended = nextStatus === "SUSPENDED" && existing.status !== "SUSPENDED";
    const reactivated = nextStatus === "ACTIVE" && existing.status === "SUSPENDED";

    const user = await db().$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          firstName: input.firstName ?? undefined,
          lastName: input.lastName ?? undefined,
          phone: input.phone === undefined ? undefined : input.phone || null,
          role: input.role ?? undefined,
          status: input.status ?? undefined,
          deactivatedById: becomesSuspended ? actor.id : undefined,
          deactivatedAt: becomesSuspended ? new Date() : reactivated ? null : undefined,
        },
        select: USER_SELECT,
      });

      await writeAudit(
        {
          entity: "USER",
          entityId: id,
          action: "update",
          actorId: actor.id,
          ipAddress: clientIp(request),
          userAgent: userAgent(request),
          changes: diffFields(
            {
              firstName: existing.firstName,
              lastName: existing.lastName,
              phone: existing.phone,
              role: existing.role,
              status: existing.status,
            },
            {
              firstName: updated.firstName,
              lastName: updated.lastName,
              phone: updated.phone,
              role: updated.role,
              status: updated.status,
            },
          ),
        },
        tx,
      );

      return updated;
    });

    if (nextStatus !== "ACTIVE" && existing.status === "ACTIVE") {
      await revokeAllUserSessions(id, "suspended");
    }

    return { user: toDto(user) };
  });

  app.post("/users/:id/password", { preHandler: requireRole("ADMIN") }, async (request) => {
    const actor = request.auth!.user;
    const cfg = loadConfig();
    const { id } = request.params as { id: string };
    const input = parseInput(userPasswordSchema, request.body);

    const existing = await db().user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!existing) throw notFound("Ο χρήστης δεν βρέθηκε.");
    if (actor.id !== id && !canManageRole(actor.role, existing.role)) {
      throw forbidden("Δεν μπορείτε να διαχειριστείτε αυτόν τον χρήστη.");
    }

    await db().user.update({
      where: { id },
      data: { passwordHash: hashPassword(input.password, cfg.PASSWORD_HASH_ROUNDS) },
    });
    await revokeAllUserSessions(id, "password_reset");

    await writeAudit({
      entity: "USER",
      entityId: id,
      action: "password_reset",
      actorId: actor.id,
      ipAddress: clientIp(request),
      userAgent: userAgent(request),
    });

    return { ok: true };
  });
}
