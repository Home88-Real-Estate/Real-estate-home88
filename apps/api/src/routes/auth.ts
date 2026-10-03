import type { FastifyInstance } from "fastify";
import { loginSchema, RATE_LIMITS } from "@home88/validation";
import { loadConfig } from "../config";
import { writeAudit } from "../lib/audit";
import { forbidden, tooManyRequests, unauthorized } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { hashPassword, verifyStoredPassword } from "../lib/passwords";
import { db } from "../lib/prisma";
import { consume } from "../lib/rate-limit";
import { createSession, revokeSessionToken, SESSION_COOKIE_NAME } from "../lib/sessions";
import { supabaseAuthConfig, verifyWithSupabaseAuth } from "../lib/supabase-auth";
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
    // A missing user and a user with no password yet both fail in the same
    // time as a wrong password; neither can ever authenticate.
    let ok = verifyStoredPassword(
      body.password,
      user?.passwordHash,
      getDummyHash(cfg.PASSWORD_HASH_ROUNDS),
    );

    // First sign-in of an account that has no CRM password yet but is linked
    // to its owner's identity-provider user: check the password there, and
    // only if the provider confirms that exact linked user, adopt it.
    const supabase = supabaseAuthConfig();
    if (!ok && user && !user.passwordHash && user.authUid && user.status === "ACTIVE" && supabase) {
      ok = await verifyWithSupabaseAuth({
        config: supabase,
        email: user.email,
        password: body.password,
        expectedUid: user.authUid,
      });
      if (ok) {
        await db().user.update({
          where: { id: user.id },
          data: { passwordHash: hashPassword(body.password, cfg.PASSWORD_HASH_ROUNDS) },
        });
        user.passwordHash = "set";
        await writeAudit({
          entity: "USER",
          entityId: user.id,
          action: "PASSWORD_ADOPTED_FROM_IDENTITY_PROVIDER",
          actorId: user.id,
          ipAddress: ip,
          userAgent: userAgent(request),
        });
      }
    }

    if (!user || !ok) throw unauthorized("Λάθος email ή κωδικός πρόσβασης.");
    if (user.status !== "ACTIVE") throw forbidden("Ο λογαριασμός δεν είναι ενεργός.");

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
