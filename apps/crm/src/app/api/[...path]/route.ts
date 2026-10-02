/**
 * Public entry to the HOME88 API on the CRM deployment.
 *
 * Requests to /crm/api/<path> (and, via the rewrite in next.config.mjs, to
 * /api/<path> on the CRM domain) are handed to the API as /api/<path>. The API
 * does all authentication, authorization, validation and CSRF checks itself;
 * this route only moves the request across. More specific CRM routes (e.g.
 * /crm/api/session) take precedence over this catch-all.
 */

import { apiUrl, callApi } from "@/lib/api-transport";

/** Request headers the API may use. Everything else is dropped. */
const FORWARD = [
  "accept",
  "content-type",
  "cookie",
  "origin",
  "user-agent",
  "x-forwarded-for",
  "if-none-match",
  "idempotency-key",
];

async function forward(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const search = new URL(request.url).search;

  const headers = new Headers();
  for (const name of FORWARD) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  try {
    return await callApi(
      new Request(apiUrl(`/api/${path.map(encodeURIComponent).join("/")}${search}`), {
        method,
        headers,
        body,
      }),
    );
  } catch (error) {
    // Logged server-side with any connection string scrubbed; the client gets
    // a generic message, never internal details.
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("[crm] API dispatch failed:", detail.replace(/\w+:\/\/[^\s"']+/g, "<url>"));
    return Response.json(
      { error: { code: "unavailable", message: "Η υπηρεσία δεν είναι διαθέσιμη." } },
      { status: 503 },
    );
  }
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;

// Every response is per-request (sessions, live data); never cache at build.
export const dynamic = "force-dynamic";
