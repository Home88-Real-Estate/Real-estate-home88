/**
 * Server-side configuration for the CRM.
 *
 * `API_URL` is deliberately not a NEXT_PUBLIC_ value: the browser never calls
 * the API directly (see src/lib/api.ts). Only the API origin and the cookie
 * name are needed here, and neither is exposed to the client bundle.
 */

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Origin of a separately running API, or empty to run the API in-process (the
 * production setup; see lib/api-transport.ts). Local development sets it to
 * http://localhost:4000 in apps/crm/.env.local.
 */
export const API_URL = trimSlash(process.env.API_URL?.trim() ?? "");

/** Must match SESSION_COOKIE_NAME on the API (default "h88_session"). */
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "h88_session";

/** Displayed in the shell; defaults to the API origin so it is never blank. */
export const CRM_ENV = process.env.NODE_ENV ?? "development";
