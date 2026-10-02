/**
 * How the CRM server reaches the HOME88 API.
 *
 *  - API_URL set: a separately running API (local development with
 *    `npm run dev`), called over HTTP.
 *  - API_URL unset (production on Vercel): the API runs inside this Next.js
 *    server process via @home88/api/handler, so the CRM and its API are one
 *    deployment and the API needs no host of its own.
 *
 * Server-only. Both paths take and return standard Request/Response objects,
 * so callers do not care which one is in use.
 */

import { API_URL } from "./config";

/** Placeholder origin for in-process requests; only the path is used. */
const IN_PROCESS_ORIGIN = "http://home88-api.internal";

export function apiUrl(pathAndQuery: string): string {
  return `${API_URL || IN_PROCESS_ORIGIN}${pathAndQuery}`;
}

export async function callApi(request: Request): Promise<Response> {
  if (API_URL) return fetch(request, { cache: "no-store" });
  const { handleApiRequest } = await import("@home88/api/handler");
  return handleApiRequest(request);
}
