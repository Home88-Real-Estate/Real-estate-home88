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
  /** Why the database is down, in plain words (no secrets). */
  databaseProblem?: DatabaseProblem;
  /** Host, port and user of DATABASE_URL; never the password. */
  databaseTarget?: Record<string, string | boolean>;
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
    return {
      status: "unavailable",
      api: "up",
      database: "down",
      configuration,
      databaseProblem: diagnoseDatabaseError(error),
      databaseTarget: describeDatabaseUrl(process.env.DATABASE_URL ?? ""),
    };
  }
}

export type DatabaseProblem = { code: string; reason: string };

/**
 * Turns a connection failure into a plain-language cause. Uses the Prisma
 * error code and well-known pooler messages only; nothing secret is echoed.
 */
export function diagnoseDatabaseError(error: unknown): DatabaseProblem {
  const e = (error ?? {}) as { errorCode?: unknown; code?: unknown; message?: unknown };
  const code = typeof e.errorCode === "string" ? e.errorCode : typeof e.code === "string" ? e.code : "unknown";
  const message = typeof e.message === "string" ? e.message : "";
  if (/tenant or user not found/i.test(message)) {
    return {
      code,
      reason:
        "The pooler does not know this user/project: the user must be postgres.<project-ref> and the host must be the pooler address shown in Supabase → Connect.",
    };
  }
  if (code === "P1000" || /password authentication failed|authentication failed/i.test(message)) {
    return { code, reason: "Wrong database password (or user) in DATABASE_URL." };
  }
  if (code === "P1013" || /invalid (port|database|connection) (number|string|url)|empty host/i.test(message)) {
    return {
      code,
      reason:
        "DATABASE_URL is not a valid address. Usually the password contains characters such as ? # & / $ @ that must be percent-encoded; use a password of letters and numbers only.",
    };
  }
  if (code === "P1001") return { code, reason: "The database host/port cannot be reached from this deployment." };
  if (code === "P1002" || code === "P1008") return { code, reason: "Connecting to the database timed out." };
  if (code === "P1003") return { code, reason: "The database name in DATABASE_URL does not exist (use /postgres)." };
  if (code === "P1011") return { code, reason: "TLS/SSL negotiation with the database failed." };
  if (code === "P1017") return { code, reason: "The database server closed the connection." };
  return { code, reason: "The database rejected or dropped the connection; see the function log." };
}

/**
 * The parts of DATABASE_URL that are safe to show (never the password), so a
 * wrong host, port or user can be spotted.
 */
export function describeDatabaseUrl(raw: string): Record<string, string | boolean> {
  if (!raw.trim()) return { valid: false, problem: "missing" };
  try {
    const url = new URL(raw);
    return {
      valid: true,
      protocol: url.protocol.replace(/:$/, ""),
      user: decodeURIComponent(url.username),
      host: url.hostname,
      port: url.port || "5432",
      database: url.pathname.replace(/^\//, ""),
      hasPassword: url.password.length > 0,
      pgbouncer: url.searchParams.get("pgbouncer") === "true",
    };
  } catch {
    return {
      valid: false,
      problem: "not a valid URL (a password with ? # & / $ @ must be percent-encoded)",
    };
  }
}
