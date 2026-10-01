/**
 * Public reference allocation (H88-000001).
 *
 * The counter is bumped inside the same transaction as the row it names, so a
 * failed insert does not burn a number and a number is never handed out twice.
 * `upsert` compiles to a single INSERT ... ON CONFLICT DO UPDATE, which makes
 * the increment atomic under concurrency.
 */

import type { Prisma } from "@home88/database";

export const REFERENCE_PREFIX = "H88";

export function formatReference(value: number): string {
  return `${REFERENCE_PREFIX}-${String(value).padStart(6, "0")}`;
}

export async function allocateReference(
  tx: Prisma.TransactionClient,
  scope: string,
): Promise<string> {
  // create.nextValue = 2 so that `nextValue - 1` is the first value handed out.
  const counter = await tx.referenceCounter.upsert({
    where: { scope },
    create: { scope, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return formatReference(counter.nextValue - 1);
}

/**
 * A deterministic, URL-safe slug derived from a title and the reference.
 * The reference suffix guarantees uniqueness even for repeated titles, so no
 * collision-retry loop is needed.
 */
export function slugify(title: string, reference: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0370-\u03ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const suffix = reference.toLowerCase();
  return base ? `${base}-${suffix}` : suffix;
}
