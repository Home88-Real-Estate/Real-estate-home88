import type { FastifyInstance } from "fastify";
import { loginSchema, RATE_LIMITS } from "@home88/validation";
import { loadConfig } from "../config";
import { writeAudit } from "../lib/audit";
import { forbidden, tooManyRequests, unauthorized } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { hashPassword, verifyPassword } from "../lib/passwords";
import { db } from "../lib/prisma";
import { consume } from "../lib/rate-limit";
import { createSession, revokeSessionToken, SESSION_COOKIE_NAME } from "../lib/sessions";
import { requireAuth } from "../plugins/auth";

/**
 * A valid hash of a random value, used to run scrypt even when the email does
 * not exist. Without it, a missing user returns immediately and the response
 * time reveals which addresses are registered.
 */
let dummyHash: string | null = null;
function getDummyHash(rounds: number): string {
  dummyHash ??= hashPassword("home88-timing-equaliser", rounds);
  return dummyHash;
}

type PublicUserSource = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  locale: string;
  avatarUrl: string | null;
};

function publicUser(user: PublicUserSource) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    locale: user.locale,
    avatarUrl: user.avatarUrl,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/login", async (request, reply) => {
    const cfg = loadConfig();
    const body = parseInput(loginSchema, request.body);
    const ip = clientIp(request);

    const limit = consume(`login:${ip}:${body.email}`, RATE_LIMITS.login);
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSeconds > 0
      ? `Too many attempts. Try again in ${limit.retryAfterSeconds}s.`
      : undefined);

    const user = await db().user.findUnique({ where: { email: body.email } });
    const ok = verifyPassword(
      body.password,
      user?.passwordHash ?? getDummyHash(cfg.PASSWORD_HASH_ROUNDS),
    );
    if (!user || !ok) throw unauthorized("Incorrect email or password.");
    if (user.status !== "ACTIVE") throw forbidden("This account is not active.");

    const session = await createSession(user.id, {
      ttlHours: cfg.SESSION_TTL_HOURS,
      ipAddress: ip,
      userAgent: userAgent(request),
    });

    reply.setCookie(SESSION_COOKIE_NAME, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: cfg.NODE_ENV === "production",
      path: "/",
      expires: session.expiresAt,
    });

    await db().user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAudit({
      entity: "USER",
      entityId: user.id,
      action: "login",
      actorId: user.id,
      ipAddress: ip,
      userAgent: userAgent(request),
    });

    return { user: publicUser(user) };
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) await revokeSessionToken(token, "logout");
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (request) => ({
    user: request.auth?.user ?? null,
  }));
}
