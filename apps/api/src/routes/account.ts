/**
 * Self-service credential management: change while signed in, and the
 * forgot/reset flow for someone who cannot sign in.
 *
 * The reset flow is written so that it never becomes an account oracle:
 *  - forgot-password returns one fixed message whether or not the email exists,
 *    and the same status;
 *  - a token is only ever hashed before it touches the database;
 *  - neither the raw token nor a password is logged, and the mailer's log-only
 *    mode records only the category, the redacted recipient and the subject.
 *
 * No schema change is involved: the existing `PasswordResetToken` table backs
 * the whole flow.
 */

import type { FastifyInstance } from "fastify";
import {
  forgotPasswordSchema,
  passwordChangeSchema,
  RATE_LIMITS,
  resetPasswordSchema,
} from "@home88/validation";
import { loadConfig } from "../config";
import { writeAudit } from "../lib/audit";
import { badRequest, tooManyRequests, unauthorized } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { sendMail } from "../lib/mailer";
import {
  generateResetToken,
  hashResetToken,
  isResetUsable,
  resetExpiry,
  RESET_TOKEN_TTL_MINUTES,
} from "../lib/password-reset";
import { hashPassword, verifyPassword } from "../lib/passwords";
import { db } from "../lib/prisma";
import { consume } from "../lib/rate-limit";
import { revokeAllUserSessions, revokeAllUserSessionsExcept } from "../lib/sessions";
import { requireAuth } from "../plugins/auth";

/** Shown for every forgot-password request, so it reveals nothing. */
const GENERIC_RESET_MESSAGE =
  "Εάν υπάρχει λογαριασμός με αυτό το email, θα σταλεί σύνδεσμος ανάκτησης.";

const INVALID_RESET_MESSAGE = "Ο σύνδεσμος ανάκτησης δεν είναι έγκυρος ή έχει λήξει.";

/**
 * Sending mail must never make the credential change fail: the password has
 * already been changed by the time we get here, and SMTP may simply be unset.
 */
async function notify(
  to: string,
  template: string,
  subject: string,
  text: string,
): Promise<void> {
  try {
    await sendMail({
      to,
      subject,
      text,
      category: "TRANSACTIONAL",
      template,
      metadata: { kind: "account_security" },
    });
  } catch {
    // Swallow: the security operation stands on its own.
  }
}

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  // --- Change password while signed in -------------------------------------
  app.post("/auth/password", { preHandler: requireAuth }, async (request) => {
    const cfg = loadConfig();
    const actor = request.auth!.user;
    const body = parseInput(passwordChangeSchema, request.body);
    const ip = clientIp(request);

    const limit = consume(`password-change:${actor.id}`, RATE_LIMITS.passwordChange);
    if (!limit.allowed) {
      throw tooManyRequests(
        limit.retryAfterSeconds > 0
          ? `Πολλές προσπάθειες. Δοκιμάστε ξανά σε ${limit.retryAfterSeconds}s.`
          : undefined,
      );
    }

    const user = await db().user.findUnique({ where: { id: actor.id } });
    if (!user) throw unauthorized();

    if (!verifyPassword(body.currentPassword, user.passwordHash)) {
      throw badRequest("Ο τρέχων κωδικός δεν είναι σωστός.", {
        currentPassword: ["Ο τρέχων κωδικός δεν είναι σωστός."],
      });
    }
    if (verifyPassword(body.newPassword, user.passwordHash)) {
      throw badRequest("Επιλέξτε έναν κωδικό που δεν έχετε ξαναχρησιμοποιήσει.", {
        newPassword: ["Επιλέξτε έναν κωδικό που δεν έχετε ξαναχρησιμοποιήσει."],
      });
    }

    await db().user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(body.newPassword, cfg.PASSWORD_HASH_ROUNDS) },
    });

    // Keep the device that changed the password signed in; drop the others.
    await revokeAllUserSessionsExcept(user.id, request.auth!.sessionId, "password_change");

    // A credential change also invalidates any in-flight reset links.
    await db().passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await writeAudit({
      entity: "USER",
      entityId: user.id,
      action: "PASSWORD_CHANGED",
      actorId: user.id,
      ipAddress: ip,
      userAgent: userAgent(request),
    });

    await notify(
      user.email,
      "password_changed",
      "Ο κωδικός σας άλλαξε | HOME88",
      "Ο κωδικός πρόσβασής σας στο HOME88 άλλαξε.\n\n" +
        "Αν δεν το κάνατε εσείς, επικοινωνήστε αμέσως με τον διαχειριστή του γραφείου.",
    );

    return { ok: true, message: "Ο κωδικός άλλαξε με επιτυχία." };
  });

  // --- Request a reset link (unauthenticated) ------------------------------
  app.post("/auth/forgot-password", async (request) => {
    const cfg = loadConfig();
    const body = parseInput(forgotPasswordSchema, request.body);
    const ip = clientIp(request);

    const limit = consume(`forgot:${ip}:${body.email}`, RATE_LIMITS.forgotPassword);
    if (!limit.allowed) {
      throw tooManyRequests(
        limit.retryAfterSeconds > 0
          ? `Πολλές προσπάθειες. Δοκιμάστε ξανά σε ${limit.retryAfterSeconds}s.`
          : undefined,
      );
    }

    const user = await db().user.findUnique({ where: { email: body.email } });

    // Only an active account gets a link; everyone gets the same answer.
    if (user && user.status === "ACTIVE") {
      const raw = generateResetToken();
      const tokenHash = hashResetToken(raw);

      await db().$transaction(async (tx) => {
        // One live link per user: requesting again retires the previous one.
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: { userId: user.id, tokenHash, expiresAt: resetExpiry() },
        });
        await writeAudit(
          {
            entity: "USER",
            entityId: user.id,
            action: "PASSWORD_RESET_REQUEST",
            actorId: user.id,
            ipAddress: ip,
            userAgent: userAgent(request),
          },
          tx,
        );
      });

      const link = `${cfg.CRM_URL}${cfg.CRM_BASE_PATH}/reset-password?token=${encodeURIComponent(raw)}`;
      await notify(
        user.email,
        "password_reset",
        "Επαναφορά κωδικού | HOME88",
        "Λάβαμε αίτημα για επαναφορά του κωδικού σας στο HOME88.\n\n" +
          `Ορίστε νέο κωδικό από τον παρακάτω σύνδεσμο (ισχύει για ${RESET_TOKEN_TTL_MINUTES} λεπτά):\n\n${link}\n\n` +
          "Αν δεν ζητήσατε εσείς επαναφορά, αγνοήστε αυτό το μήνυμα.",
      );
    }

    return { ok: true, message: GENERIC_RESET_MESSAGE };
  });

  // --- Redeem a reset link (unauthenticated) -------------------------------
  app.post("/auth/reset-password", async (request) => {
    const cfg = loadConfig();
    const body = parseInput(resetPasswordSchema, request.body);
    const ip = clientIp(request);

    const limit = consume(`reset:${ip}`, RATE_LIMITS.resetPassword);
    if (!limit.allowed) {
      throw tooManyRequests(
        limit.retryAfterSeconds > 0
          ? `Πολλές προσπάθειες. Δοκιμάστε ξανά σε ${limit.retryAfterSeconds}s.`
          : undefined,
      );
    }

    const row = await db().passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(body.token) },
      include: { user: true },
    });

    // Unknown, expired, already used, or an account that is no longer active:
    // one message, no detail.
    if (!row || !isResetUsable(row) || row.user.status !== "ACTIVE") {
      throw badRequest(INVALID_RESET_MESSAGE);
    }

    await db().$transaction(async (tx) => {
      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash: hashPassword(body.newPassword, cfg.PASSWORD_HASH_ROUNDS) },
      });
      await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
      // Any sibling link is dead the moment one is redeemed.
      await tx.passwordResetToken.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await writeAudit(
        {
          entity: "USER",
          entityId: row.userId,
          action: "PASSWORD_RESET_SUCCESS",
          actorId: row.userId,
          ipAddress: ip,
          userAgent: userAgent(request),
        },
        tx,
      );
    });

    // A reset is a recovery, so every existing session is treated as suspect.
    await revokeAllUserSessions(row.userId, "password_reset");

    await notify(
      row.user.email,
      "password_changed",
      "Ο κωδικός σας άλλαξε | HOME88",
      "Ο κωδικός πρόσβασής σας στο HOME88 επαναφέρθηκε με επιτυχία.\n\n" +
        "Για ασφάλεια, όλες οι ενεργές συνεδρίες τερματίστηκαν. Συνδεθείτε ξανά με τον νέο κωδικό.\n\n" +
        "Αν δεν το κάνατε εσείς, επικοινωνήστε αμέσως με τον διαχειριστή του γραφείου.",
    );

    return { ok: true, message: "Ο κωδικός επαναφέρθηκε. Συνδεθείτε ξανά." };
  });
}
