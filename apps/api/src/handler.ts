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

import { configProblems } from "./config";
import { db } from "./lib/prisma";
import { buildServer } from "./server";

const UNAVAILABLE_MESSAGE = "Η υπηρεσία δεν είναι προσωρινά διαθέσιμη. Παρακαλούμε δοκιμάστε ξανά αργότερα.";

/** Error text with anything URL-shaped (e.g. a connection string) removed. */
function safeDetail(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/\w+:\/\/[^\s"']+/g, "<url>");
}

/**
 * Explains a failed boot in the server log: which variables are missing or
 * invalid (names only), or the scrubbed error when configuration is fine.
 */
function logBootFailure(error: unknown): void {
  const problems = configProblems();
  if (problems.length > 0) {
    const list = problems.map((p) => `${p.variable} (${p.problem})`).join(", ");
    console.error(`[home88:api] cannot start: fix these environment variables on this deployment: ${list}`);
  } else {
    console.error("[home88:api] cannot start:", safeDetail(error));
  }
}

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
  let app: FastifyInstance;
  try {
    app = await api();
  } catch (error) {
    // The API could not start (usually a missing or invalid environment
    // variable). Say so in the log and answer with a controlled 503 instead
    // of letting the caller turn an exception into a 502.
    logBootFailure(error);
    return Response.json(
      { error: { code: "api_unavailable", message: UNAVAILABLE_MESSAGE } },
      { status: 503, headers: { "retry-after": "30" } },
    );
  }
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

export type ApiReadiness = {
  status: "ready" | "unavailable";
  api: "up" | "down";
  database: "up" | "down" | "unknown";
  /** Names of environment variables that are missing or invalid; never values. */
  configuration: Array<{ variable: string; problem: string }>;
};

/**
 * Readiness of the in-process API: does it start, does the database answer,
 * and, if not, which variables are wrong. Nothing secret is returned.
 */
export async function apiReadiness(): Promise<ApiReadiness> {
  const configuration = configProblems();
  if (configuration.length > 0) {
    return { status: "unavailable", api: "down", database: "unknown", configuration };
  }
  try {
    await api();
  } catch (error) {
    logBootFailure(error);
    return { status: "unavailable", api: "down", database: "unknown", configuration };
  }
  try {
    await db().$queryRaw`SELECT 1`;
    return { status: "ready", api: "up", database: "up", configuration };
  } catch (error) {
    console.error("[home88:api] database check failed:", safeDetail(error));
    return { status: "unavailable", api: "up", database: "down", configuration };
  }
}
