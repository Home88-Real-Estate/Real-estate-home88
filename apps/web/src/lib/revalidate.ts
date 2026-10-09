import { createHash, timingSafeEqual } from "node:crypto";

/**
 * On-demand refresh of the pages a publication change touches.
 *
 * The CRM calls this after it publishes, updates or takes down a listing, so a
 * property page, the listings, the area pages and the sitemap stop serving a
 * stale copy at once instead of when their cache expires. It carries no data and
 * changes nothing in the database: it only discards cached HTML.
 *
 * Protected by a shared secret (WEBSITE_REVALIDATE_SECRET, the same value the CRM
 * holds). With no secret configured it refuses everything. The function takes the
 * revalidation call as a parameter so it can be tested outside the Next runtime.
 */

const REFERENCE = /^H88-\d{6}$/i;
export const MAX_REFERENCES = 50;

function sameSecret(given: string, expected: string): boolean {
  // Hash first so the comparison is constant-time whatever the lengths.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export type RevalidateOutcome = { status: number; body: { ok: boolean; message?: string; revalidated?: string[] } };

export async function handleRevalidate(
  request: Request,
  revalidate: (path: string) => void,
  secret: string | undefined = process.env.WEBSITE_REVALIDATE_SECRET,
): Promise<RevalidateOutcome> {
  const expected = secret?.trim();
  if (!expected) return { status: 503, body: { ok: false, message: "not_configured" } };
  if (!sameSecret(request.headers.get("x-revalidate-secret") ?? "", expected)) {
    return { status: 401, body: { ok: false, message: "unauthorized" } };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, body: { ok: false, message: "bad_request" } };
  }
  const references = (body as { references?: unknown } | null)?.references;
  if (!Array.isArray(references) || references.length > MAX_REFERENCES || !references.every((r) => typeof r === "string" && REFERENCE.test(r))) {
    return { status: 400, body: { ok: false, message: "bad_request" } };
  }

  const paths = [...new Set(references.map((r: string) => `/property/${r.toUpperCase()}`)), "/", "/properties", "/areas", "/sitemap.xml"];
  for (const path of paths) revalidate(path);
  return { status: 200, body: { ok: true, revalidated: paths } };
}
