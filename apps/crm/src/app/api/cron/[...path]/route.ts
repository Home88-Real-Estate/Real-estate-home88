/**
 * Scheduled jobs (/crm/api/cron/*). Same as the catch-all, plus the
 * Authorization header the scheduler sends (Vercel Cron: `Bearer CRON_SECRET`).
 * Cookies are not forwarded: a job is never run as a signed-in user.
 */

import { apiUrl, callApi } from "@/lib/api-transport";

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  const headers = new Headers();
  for (const name of ["authorization", "accept", "content-type", "user-agent", "x-forwarded-for"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const method = request.method.toUpperCase();
  return callApi(
    new Request(apiUrl(`/api/cron/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`), {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    }),
  );
}

export const GET = forward;
export const POST = forward;
export const dynamic = "force-dynamic";
