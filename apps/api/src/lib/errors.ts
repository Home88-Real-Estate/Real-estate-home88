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

export const unauthorized = (message = "Sign in to continue.") =>
  new HttpError(401, "unauthorized", message);

export const forbidden = (message = "You do not have access to this resource.") =>
  new HttpError(403, "forbidden", message);

export const notFound = (message = "Not found.") => new HttpError(404, "not_found", message);

export const conflict = (message: string) => new HttpError(409, "conflict", message);

export const tooManyRequests = (message = "Too many requests. Try again later.") =>
  new HttpError(429, "rate_limited", message);

export const validationFailed = (message: string, fields?: FieldErrors) =>
  new HttpError(422, "validation_failed", message, fields);

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
