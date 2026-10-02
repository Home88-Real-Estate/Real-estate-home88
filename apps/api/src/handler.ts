/**
 * Runs the API inside another server process (the CRM's Vercel deployment)
 * instead of as its own long-running server.
 *
 * The Fastify app is built once per process and requests are dispatched to it
 * with `inject`, which exercises the full stack (hooks, auth, validation,
 * error handler) without opening a port. This is the only hosting-specific
 * code: routes and business logic are identical to the standalone server in
 * index.ts, which is still used for local development.
 */

import type { FastifyInstance } from "fastify";

import { buildServer } from "./server";

let appPromise: Promise<FastifyInstance> | null = null;

function api(): Promise<FastifyInstance> {
  appPromise ??= buildServer()
    .then(async (app) => {
      await app.ready();
      return app;
    })
    .catch((error: unknown) => {
      // Let the next request retry instead of caching a failed boot.
      appPromise = null;
      throw error;
    });
  return appPromise;
}

/** Hop-by-hop or length headers that must not be copied between transports. */
const SKIP_RESPONSE_HEADERS = new Set(["content-length", "transfer-encoding", "connection", "keep-alive"]);

/**
 * Handles one API request. `request.url` must carry the API path (`/api/...`
 * or `/health`); the origin part is ignored.
 */
export async function handleApiRequest(request: Request): Promise<Response> {
  const app = await api();
  const url = new URL(request.url);

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const method = request.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer());

  const result = await app.inject({
    method: method as "GET",
    url: `${url.pathname}${url.search}`,
    headers,
    ...(body && body.length > 0 ? { payload: body } : {}),
  });

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(result.headers)) {
    if (value === undefined || SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      responseHeaders.append(key, String(item));
    }
  }

  const noBody = method === "HEAD" || result.statusCode === 204 || result.statusCode === 304;
  return new Response(noBody ? null : new Uint8Array(result.rawPayload), {
    status: result.statusCode,
    headers: responseHeaders,
  });
}
