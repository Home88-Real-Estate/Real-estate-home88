/**
 * Append-only audit trail.
 *
 * `changes` is redacted before it is written: an audit row must record *that*
 * a personal field changed without becoming a second, unencrypted copy of the
 * value. Personal keys are replaced with a marker rather than dropped, so the
 * history still shows the field was touched.
 */

import type { AuditEntity, Prisma } from "@home88/database";
import { db } from "./prisma";

const PERSONAL_KEY_PATTERN = /(email|phone|mobile|taxid|address|dateofbirth|password)/i;

export function redactChanges(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactChanges(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = PERSONAL_KEY_PATTERN.test(key) ? "[redacted]" : redactChanges(val, depth + 1);
  }
  return out;
}

export type AuditInput = {
  entity: AuditEntity;
  entityId: string;
  action: string;
  changes?: unknown;
  actorId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function writeAudit(
  input: AuditInput,
  client: Pick<Prisma.TransactionClient, "auditLog"> = db(),
): Promise<void> {
  const changes =
    input.changes === undefined ? undefined : (redactChanges(input.changes) as Prisma.InputJsonValue);

  await client.auditLog.create({
    data: {
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      changes: changes ?? undefined,
      actorId: input.actorId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

/** Computes a shallow before/after diff, omitting unchanged keys. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) diff[key] = { from: a, to: b };
  }
  return diff;
}
