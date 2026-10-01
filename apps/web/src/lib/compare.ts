/**
 * Comparison constants and URL parsing.
 *
 * Kept free of `window` and of the `"use client"` directive so that both the
 * browser store (`compare-store`) and the server-rendered /compare page can
 * share it without crossing the client boundary.
 */

export const COMPARE_MAX = 4;
export const COMPARE_EVENT = "home88:compare-changed";

const REFERENCE_RE = /^H88-\d{6}$/i;

export function dedupeRefs(refs: string[]): string[] {
  return [...new Set(refs.map((r) => r.toUpperCase()))];
}

export function isValidReference(value: string): boolean {
  return REFERENCE_RE.test(value);
}

/** Parses the `refs` query parameter, dropping anything malformed. */
export function parseRefsParam(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  return dedupeRefs(raw.split(",").filter((r) => REFERENCE_RE.test(r))).slice(0, COMPARE_MAX);
}
