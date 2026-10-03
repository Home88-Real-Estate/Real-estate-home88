/**
 * Errors that are safe to serialise to a client.
 *
 * Anything that is not an HttpError is treated as an internal fault and its
 * message is replaced with a generic one: Prisma and connection errors can
 * contain a connection string, and those must never reach a response body.
 */

export type FieldErrors = Record<string, string[]>;

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fields?: FieldErrors;

  constructor(statusCode: number, code: string, message: string, fields?: FieldErrors) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message: string, fields?: FieldErrors) =>
  new HttpError(400, "bad_request", message, fields);

export const unauthorized = (message = "Συνδεθείτε για να συνεχίσετε.") =>
  new HttpError(401, "unauthorized", message);

export const forbidden = (message = "You do not have access to this resource.") =>
  new HttpError(403, "forbidden", message);

export const notFound = (message = "Δεν βρέθηκε.") => new HttpError(404, "not_found", message);

export const conflict = (message: string) => new HttpError(409, "conflict", message);

export const tooManyRequests = (message = "Too many requests. Try again later.") =>
  new HttpError(429, "rate_limited", message);

export const validationFailed = (message: string, fields?: FieldErrors) =>
  new HttpError(422, "validation_failed", message, fields);

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

/** Prisma error codes that mean "the database cannot be reached/used right now". */
const DATABASE_UNAVAILABLE_CODES = new Set(["P1000", "P1001", "P1002", "P1003", "P1008", "P1017", "P2024"]);

/**
 * True for errors meaning the database is unreachable or refusing connections
 * (as opposed to a bug or bad input). Matched by name/code so this module does
 * not depend on the Prisma runtime.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; code?: unknown; errorCode?: unknown };
  if (e.name === "PrismaClientInitializationError") return true;
  for (const code of [e.code, e.errorCode]) {
    if (typeof code === "string" && DATABASE_UNAVAILABLE_CODES.has(code)) return true;
  }
  return false;
}
