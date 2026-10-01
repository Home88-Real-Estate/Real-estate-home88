/**
 * Server-side API client.
 *
 * Every call runs on the Next server and forwards the session cookie from the
 * incoming request, so the opaque session token never reaches the browser's
 * JavaScript. The browser only ever talks to this origin, which is why the CSP
 * needs no API origin and CORS is not in play.
 */

import { cookies } from "next/headers";
import type { AppError } from "@home88/types";

import { API_URL, SESSION_COOKIE_NAME } from "./config";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: AppError };

export type QueryValue = string | number | boolean | undefined | null;

export type ApiFetchInit = {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  /** Serialised as JSON and sent with a JSON content-type. */
  json?: unknown;
  /**
   * Multipart body. The content-type header is deliberately not set so fetch
   * adds the boundary itself; setting it by hand breaks the upload.
   */
  form?: FormData;
  query?: Record<string, QueryValue>;
};

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_URL}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<ApiResult<T>> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  const headers = new Headers();
  headers.set("accept", "application/json");
  if (token) headers.set("cookie", `${SESSION_COOKIE_NAME}=${token}`);
  if (init.json !== undefined) headers.set("content-type", "application/json");

  const hasBody = init.json !== undefined || init.form !== undefined;
  let response: Response;
  try {
    response = await fetch(buildUrl(path, init.query), {
      method: init.method ?? (hasBody ? "POST" : "GET"),
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.form,
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: "network_error", message: "Cannot reach the API. Is it running?" },
    };
  }

  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const error = (body as { error?: AppError } | null)?.error;
    return {
      ok: false,
      status: response.status,
      error: error ?? { code: "error", message: `Request failed (${response.status}).` },
    };
  }

  return { ok: true, data: (body ?? {}) as T };
}
