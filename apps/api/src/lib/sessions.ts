/**
 * Opaque, database-backed sessions.
 *
 * The cookie carries a random token; the database stores only its SHA-256.
 * A database leak therefore yields no usable session, and revoking a session is
 * a row update rather than waiting for a token to expire.
 */

import { createHash, randomBytes } from "node:crypto";
import { db } from "./prisma";

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "h88_session";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type CreatedSession = { token: string; expiresAt: Date; sessionId: string };

export async function createSession(
  userId: string,
  opts: { ttlHours: number; ipAddress?: string | null; userAgent?: string | null },
): Promise<CreatedSession> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + opts.ttlHours * 60 * 60 * 1000);

  const session = await db().session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
    },
  });

  return { token, expiresAt, sessionId: session.id };
}

export type VerifiedSession = {
  sessionId: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    status: string;
    locale: string;
  };
};

export async function verifySessionToken(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null;

  const session = await db().session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.user.status !== "ACTIVE") return null;

  return {
    sessionId: session.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      firstName: session.user.firstName,
      lastName: session.user.lastName,
      role: session.user.role,
      status: session.user.status,
      locale: session.user.locale,
    },
  };
}

export async function revokeSessionToken(token: string, reason: string): Promise<void> {
  await db().session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeAllUserSessions(userId: string, reason: string): Promise<void> {
  await db().session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/**
 * Revokes every session except the one performing the credential change, so a
 * password change signs out other devices without bouncing the current user.
 */
export async function revokeAllUserSessionsExcept(
  userId: string,
  keepSessionId: string,
  reason: string,
): Promise<void> {
  await db().session.updateMany({
    where: { userId, revokedAt: null, NOT: { id: keepSessionId } },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}
