/** Shared HTTP glue for the document routes: audit context and error mapping. */

import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

import { BrokerageError, DocumentBlockedError } from "./brokerage/errors";
import { PdfRenderError } from "./brokerage/documents/pdf";
import type { AuditContext } from "./brokerage/documents/audit";
import { HttpError } from "./errors";
import { clientIp, userAgent } from "./http";

export type Actor = { id: string; role: string; firstName: string; lastName: string; email: string };
export const nameOf = (a: Actor) => `${a.firstName} ${a.lastName}`.trim() || a.email;

export function actorOf(request: FastifyRequest): Actor {
  return request.auth!.user as Actor;
}

export function auditContext(request: FastifyRequest): AuditContext & { actor: { id: string; name: string; role: string } } {
  const a = actorOf(request);
  return {
    actor: { id: a.id, name: nameOf(a), role: a.role },
    actorUserId: a.id,
    actorRole: a.role,
    requestId: typeof request.id === "string" ? request.id : randomUUID(),
    ipAddress: clientIp(request),
    userAgent: userAgent(request),
  };
}

const NOT_FOUND = /NOT_FOUND$/;
const FORBIDDEN = new Set(["FORBIDDEN"]);

/** Turns a workflow error into a safe HTTP error; anything else is left to the global handler. */
export function toHttp(error: unknown): unknown {
  if (error instanceof DocumentBlockedError) {
    const fields: Record<string, string[]> = {};
    for (const i of error.result.blockingIssues) (fields[i.field ?? "_"] ??= []).push(i.message);
    return new HttpError(422, "document_blocked", "Το έγγραφο δεν είναι έτοιμο για έκδοση.", fields);
  }
  if (error instanceof PdfRenderError) return new HttpError(422, "pdf_unrenderable", error.message);
  if (error instanceof BrokerageError) {
    if (NOT_FOUND.test(error.code)) return new HttpError(404, "not_found", error.message);
    if (FORBIDDEN.has(error.code)) return new HttpError(403, "forbidden", error.message);
    if (error.code === "REASON_REQUIRED" || error.code === "INVALID_DATE") return new HttpError(400, "bad_request", error.message);
    return new HttpError(409, "conflict", error.message);
  }
  return error;
}

/** Runs a handler body and maps workflow errors. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toHttp(error);
  }
}
