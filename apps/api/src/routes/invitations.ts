/**
 * Staff invitations.
 *
 * An admin invites a colleague by email; the account is not created until the
 * invitee opens the link and chooses their own password. That keeps credentials
 * out of the inviter's hands. Tokens are opaque, stored hashed, single-use,
 * revocable and expiring — the same discipline as sessions and resets.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import {
  invitationAcceptSchema,
  invitationCreateSchema,
  RATE_LIMITS,
} from "@home88/validation";
import { loadConfig } from "../config";
import { writeAudit } from "../lib/audit";
import { HttpError, badRequest, forbidden, notFound, tooManyRequests } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  isInviteUsable,
} from "../lib/invitations";
import { sendMail } from "../lib/mailer";
import { hashPassword } from "../lib/passwords";
import { db } from "../lib/prisma";
import { consume } from "../lib/rate-limit";
import { ROLE_RANK, requireRole } from "../plugins/auth";
import { assertPasswordPolicy } from "../settings/password-policy";

/** Peers cannot invite peers: an inviter must outrank the role they grant. */
function canInviteRole(actorRole: string, targetRole: string): boolean {
  return (ROLE_RANK[actorRole] ?? -1) > (ROLE_RANK[targetRole] ?? Number.POSITIVE_INFINITY);
}

const listQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "revoked", "all"]).optional().default("pending"),
});

const INVALID_INVITE_MESSAGE = "Η πρόσκληση δεν είναι έγκυρη ή έχει λήξει.";

/** Sending mail must never fail the operation that produced it. */
async function notify(to: string, template: string, subject: string, text: string): Promise<void> {
  try {
    await sendMail({
      to,
      subject,
      text,
      category: "TRANSACTIONAL",
      template,
      metadata: { kind: "staff_invitation" },
    });
  } catch {
    // Swallow: the invitation row is already committed.
  }
}

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/invitations", { preHandler: requireRole("MANAGER") }, async (request) => {
    const q = parseInput(listQuerySchema, request.query);
    const now = new Date();

    const where: Prisma.InvitationWhereInput =
      q.status === "pending"
        ? { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }
        : q.status === "accepted"
          ? { acceptedAt: { not: null } }
          : q.status === "revoked"
            ? { revokedAt: { not: null } }
            : {};

    const rows = await db().invitation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { invitedBy: { select: { firstName: true, lastName: true } } },
    });

    return {
      data: rows.map((row) => ({
        id: row.id,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        role: row.role,
        expiresAt: row.expiresAt.toISOString(),
        acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        invitedBy: `${row.invitedBy.firstName} ${row.invitedBy.lastName}`.trim(),
      })),
    };
  });

  app.post("/invitations", { preHandler: requireRole("ADMIN") }, async (request, reply) => {
    const cfg = loadConfig();
    const actor = request.auth!.user;
    const input = parseInput(invitationCreateSchema, request.body);
    const ip = clientIp(request);

    const limit = consume(`invite:${actor.id}`, RATE_LIMITS.invitationCreate);
    if (!limit.allowed) {
      throw tooManyRequests(
        limit.retryAfterSeconds > 0
          ? `Too many invitations. Try again in ${limit.retryAfterSeconds}s.`
          : undefined,
      );
    }

    if (!canInviteRole(actor.role, input.role)) {
      throw forbidden("Δεν μπορείτε να προσκαλέσετε χρήστη με αυτόν τον ρόλο.");
    }

    const alreadyUser = await db().user.findUnique({ where: { email: input.email } });
    if (alreadyUser) {
      throw new HttpError(409, "email_taken", "A user with this email already exists.");
    }

    const raw = generateInviteToken();
    const invitation = await db().$transaction(async (tx) => {
      // One live invitation per address: a re-invite retires the previous one.
      await tx.invitation.updateMany({
        where: { email: input.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      const created = await tx.invitation.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone || null,
          role: input.role,
          tokenHash: hashInviteToken(raw),
          invitedById: actor.id,
          expiresAt: inviteExpiry(),
        },
      });

      await writeAudit(
        {
          entity: "USER",
          entityId: created.id,
          action: "INVITATION_SENT",
          actorId: actor.id,
          ipAddress: ip,
          userAgent: userAgent(request),
          changes: { email: created.email, role: created.role },
        },
        tx,
      );

      return created;
    });

    const link = `${cfg.CRM_URL}${cfg.CRM_BASE_PATH}/accept-invite?token=${encodeURIComponent(raw)}`;
    await notify(
      invitation.email,
      "staff_invitation",
      "Πρόσκληση συνεργάτη | HOME88",
      `Σας προσκάλεσαν να αποκτήσετε πρόσβαση στο σύστημα του HOME88 ως συνεργάτης.\n\n` +
        `Ορίστε τον κωδικό σας από τον παρακάτω σύνδεσμο (ισχύει για 7 ημέρες):\n\n${link}\n\n` +
        "Αν δεν περιμένατε αυτή την πρόσκληση, αγνοήστε το μήνυμα.",
    );

    reply.code(201);
    return {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    };
  });

  app.post("/invitations/:id/revoke", { preHandler: requireRole("ADMIN") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };

    const existing = await db().invitation.findUnique({ where: { id } });
    if (!existing) throw notFound("Η πρόσκληση δεν βρέθηκε.");
    if (!isInviteUsable(existing)) throw badRequest("Η πρόσκληση δεν είναι πλέον ενεργή.");

    await db().invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await writeAudit({
      entity: "USER",
      entityId: id,
      action: "INVITATION_REVOKED",
      actorId: actor.id,
      ipAddress: clientIp(request),
      userAgent: userAgent(request),
      changes: { email: existing.email, role: existing.role },
    });

    return { ok: true };
  });

  app.post("/invitations/accept", async (request) => {
    const cfg = loadConfig();
    const input = parseInput(invitationAcceptSchema, request.body);
    await assertPasswordPolicy(input.password, "password");
    const ip = clientIp(request);

    const limit = consume(`invite-accept:${ip}`, RATE_LIMITS.invitationAccept);
    if (!limit.allowed) {
      throw tooManyRequests(
        limit.retryAfterSeconds > 0
          ? `Too many attempts. Try again in ${limit.retryAfterSeconds}s.`
          : undefined,
      );
    }

    const row = await db().invitation.findUnique({ where: { tokenHash: hashInviteToken(input.token) } });
    if (!row || !isInviteUsable(row)) throw badRequest(INVALID_INVITE_MESSAGE);

    const alreadyUser = await db().user.findUnique({ where: { email: row.email } });
    if (alreadyUser) throw badRequest(INVALID_INVITE_MESSAGE);

    const created = await db().$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: row.email,
          passwordHash: hashPassword(input.password, cfg.PASSWORD_HASH_ROUNDS),
          firstName: row.firstName,
          lastName: row.lastName,
          phone: row.phone,
          role: row.role,
          status: "ACTIVE",
          createdById: row.invitedById,
        },
        select: { id: true, email: true },
      });

      await tx.invitation.update({ where: { id: row.id }, data: { acceptedAt: new Date() } });
      // Any sibling invite for the same address is dead once this one is used.
      await tx.invitation.updateMany({
        where: { email: row.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await writeAudit(
        {
          entity: "USER",
          entityId: user.id,
          action: "INVITATION_ACCEPTED",
          actorId: user.id,
          ipAddress: ip,
          userAgent: userAgent(request),
        },
        tx,
      );

      return user;
    });

    await notify(
      created.email,
      "welcome",
      "Ο λογαριασμός σας ενεργοποιήθηκε | HOME88",
      "Ο λογαριασμός σας στο σύστημα του HOME88 ενεργοποιήθηκε.\n\n" +
        "Μπορείτε να συνδεθείτε με το email και τον κωδικό που μόλις ορίσατε.",
    );

    return { ok: true, message: "Ο λογαριασμός ενεργοποιήθηκε. Συνδεθείτε με τον νέο κωδικό." };
  });
}
