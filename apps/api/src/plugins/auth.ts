/**
 * Authentication and authorisation.
 *
 * Session state is resolved once per request in an onRequest hook and attached
 * to the request, so a route never re-reads the cookie. Authorisation is a
 * hierarchy rather than an equality check, because a SUPER_ADMIN must be able
 * to do everything an ADMIN can without listing every role at every route.
 */

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { SESSION_COOKIE_NAME, verifySessionToken, type VerifiedSession } from "../lib/sessions";
import { forbidden, unauthorized } from "../lib/errors";

export const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  MARKETING: 1,
  AGENT: 2,
  MANAGER: 3,
  ADMIN: 4,
  SUPER_ADMIN: 5,
};

export function roleAtLeast(role: string, minimum: string): boolean {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minimum] ?? Number.POSITIVE_INFINITY);
}

declare module "fastify" {
  interface FastifyRequest {
    auth: VerifiedSession | null;
  }
}

export async function attachAuth(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE_NAME];
  request.auth = await verifySessionToken(token);
}

/** Route guard: any signed-in, active user. */
export const requireAuth: preHandlerHookHandler = async (request: FastifyRequest, _reply: FastifyReply) => {
  if (!request.auth) throw unauthorized();
};

/** Route guard: signed in at or above the given role. */
export function requireRole(minimum: string): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.auth) throw unauthorized();
    if (!roleAtLeast(request.auth.user.role, minimum)) throw forbidden();
  };
}
