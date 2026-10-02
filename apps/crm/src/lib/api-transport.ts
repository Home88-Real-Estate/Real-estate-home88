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

export const UNAVAILABLE_MESSAGE =
  "Η υπηρεσία δεν είναι προσωρινά διαθέσιμη. Παρακαλούμε δοκιμάστε ξανά αργότερα.";

/** Error text with anything URL-shaped (e.g. a connection string) removed. */
export function safeDetail(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/\w+:\/\/[^\s"']+/g, "<url>");
}

function unavailable(): Response {
  return Response.json(
    { error: { code: "api_unavailable", message: UNAVAILABLE_MESSAGE } },
    { status: 503, headers: { "retry-after": "30" } },
  );
}

/**
 * Sends one request to the API. Never throws: when the API cannot be reached
 * the reason is logged (without secrets) and the caller gets a controlled 503.
 */
export async function callApi(request: Request): Promise<Response> {
  if (API_URL) {
    try {
      return await fetch(request, { cache: "no-store" });
    } catch (error) {
      console.error(
        "[crm] API_URL is set but the API cannot be reached. In production leave API_URL unset " +
          "(the API runs inside the CRM).",
        safeDetail(error),
      );
      return unavailable();
    }
  }
  try {
    const { handleApiRequest } = await import("@home88/api/handler");
    return await handleApiRequest(request);
  } catch (error) {
    console.error("[crm] in-process API failed:", safeDetail(error));
    return unavailable();
  }
}
