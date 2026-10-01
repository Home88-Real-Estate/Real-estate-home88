"use client";

/**
 * Comparison selection stored entirely in the browser.
 *
 * Only public property references are kept — no personal data, no token — so
 * this does not require a consent category. The /compare page re-fetches the
 * real listings from the references, which keeps the data fresh and means the
 * browser never has to hold a stale copy of a listing.
 */

import { COMPARE_EVENT, COMPARE_MAX, dedupeRefs, isValidReference } from "@/lib/compare";

export const COMPARE_KEY = "home88:compare";

export { COMPARE_EVENT, COMPARE_MAX };

export function readCompare(): string[] {
  try {
    const raw = window.localStorage.getItem(COMPARE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupeRefs(
      parsed.filter((v): v is string => typeof v === "string" && isValidReference(v)),
    ).slice(0, COMPARE_MAX);
  } catch {
    return [];
  }
}

export function writeCompare(refs: string[]): string[] {
  const next = dedupeRefs(refs).slice(0, COMPARE_MAX);
  try {
    window.localStorage.setItem(COMPARE_KEY, JSON.stringify(next));
  } catch {
    /* storage disabled — selection simply does not persist */
  }
  window.dispatchEvent(new Event(COMPARE_EVENT));
  return next;
}

export function isCompared(reference: string): boolean {
  return readCompare().includes(reference.toUpperCase());
}

export function toggleCompare(reference: string): string[] {
  const current = readCompare();
  const ref = reference.toUpperCase();
  return writeCompare(current.includes(ref) ? current.filter((r) => r !== ref) : [...current, ref]);
}
