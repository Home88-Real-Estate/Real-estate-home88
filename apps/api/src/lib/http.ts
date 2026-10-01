/** Small request helpers shared by the route modules. */

import type { FastifyRequest } from "fastify";
import type { ZodType, ZodTypeDef } from "zod";
import { validationFailed } from "./errors";

/**
 * Validate and narrow a request body/query. Zod issues are grouped by field so
 * the CRM can render a message against the input that produced it.
 *
 * The input type is fixed to `unknown` on purpose: schemas here use defaults
 * and transforms, so their input and output types differ. Constraining them to
 * be equal would widen the output (making defaulted fields optional).
 */
export function parseInput<TOut>(schema: ZodType<TOut, ZodTypeDef, unknown>, data: unknown): TOut {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? issue.path.join(".") : "_";
      const bucket = fields[key] ?? [];
      bucket.push(issue.message);
      fields[key] = bucket;
    }
    throw validationFailed("Some fields need attention.", fields);
  }
  return result.data;
}

/** Trusts X-Forwarded-For only because the API is expected to sit behind a proxy. */
export function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0];
    if (first) return first.trim();
  }
  return request.ip;
}

export function userAgent(request: FastifyRequest): string | null {
  const ua = request.headers["user-agent"];
  return typeof ua === "string" ? ua : null;
}
