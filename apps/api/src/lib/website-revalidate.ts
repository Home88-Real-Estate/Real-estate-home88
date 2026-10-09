/**
 * Asks the public website to refresh the pages a publication change touches.
 *
 * The website (a separate deployment) caches property pages, listings and the
 * sitemap for a few minutes. A database change is the truth; this call only
 * shortens how long a stale page can be served. It therefore never throws and
 * never fails an operation: the outcome is reported back so the CRM can say
 * "refreshed", "will refresh within a few minutes" or "could not reach the site".
 *
 * The only host ever contacted is the configured SITE_URL, and the secret
 * travels in a header, never in a URL or a log line.
 */

import { loadConfig } from "../config";

export type Revalidation = {
  attempted: boolean;
  ok: boolean;
  /** `revalidated`, `not_configured`, `unreachable` or `http_<status>`. */
  note: string;
};

const TIMEOUT_MS = 5000;

export async function revalidateWebsite(references: readonly string[]): Promise<Revalidation> {
  const cfg = loadConfig();
  const secret = cfg.WEBSITE_REVALIDATE_SECRET.trim();
  if (!secret) return { attempted: false, ok: false, note: "not_configured" };

  const unique = [...new Set(references.map((r) => r.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
  try {
    const response = await fetch(`${cfg.SITE_URL.replace(/\/+$/, "")}/api/revalidate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-revalidate-secret": secret },
      body: JSON.stringify({ references: unique }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? { attempted: true, ok: true, note: "revalidated" } : { attempted: true, ok: false, note: `http_${response.status}` };
  } catch {
    return { attempted: true, ok: false, note: "unreachable" };
  }
}

export const REVALIDATION_TEXT: Readonly<Record<string, string>> = {
  revalidated: "Η δημόσια σελίδα ανανεώθηκε.",
  not_configured: "Η δημόσια σελίδα θα ανανεωθεί μέσα σε λίγα λεπτά (δεν έχει ρυθμιστεί άμεση ανανέωση).",
  unreachable: "Δεν ήταν δυνατή η άμεση ανανέωση· η δημόσια σελίδα θα ανανεωθεί μέσα σε λίγα λεπτά.",
};

export function revalidationMessage(r: Revalidation): string {
  return REVALIDATION_TEXT[r.note] ?? "Δεν ήταν δυνατή η άμεση ανανέωση· η δημόσια σελίδα θα ανανεωθεί μέσα σε λίγα λεπτά.";
}
