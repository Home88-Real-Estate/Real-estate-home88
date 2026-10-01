import { createHash } from "node:crypto";

import type { PortalProperty } from "./types";

/**
 * JSON with object keys sorted at every level, so two structurally identical
 * values serialise to the same bytes regardless of property insertion order.
 */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalise(source[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Stable content hash of a property.
 *
 * `updatedAt` is excluded on purpose: editing an unrelated field (an internal
 * note, an agent assignment) touches the row but does not change what a portal
 * would display, so it must not trigger a re-push. Only displayable content
 * moves the hash.
 */
export function propertyContentHash(property: PortalProperty): string {
  const { updatedAt: _ignored, ...content } = property;
  return sha256(canonicalJson(content));
}

/** Combines per-property hashes into one feed hash, independent of order. */
export function combineHashes(hashes: string[]): string {
  return sha256([...hashes].sort().join(":"));
}
