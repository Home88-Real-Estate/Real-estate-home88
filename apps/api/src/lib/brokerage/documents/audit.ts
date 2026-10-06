/**
 * The document audit trail (append-only table `document_audit_events`).
 *
 * Personal data never reaches it. `before` and `after` are small, hand-picked
 * states built by the caller; as a second line of defence everything is passed
 * through `maskAuditPayload`, which blanks any value under a sensitive key and
 * any tax-id-shaped number or email address inside free text.
 */

import type { Prisma } from "@home88/database";

import type { Db } from "../types";

export const DOCUMENT_AUDIT_EVENTS = [
  "SHOWING_CREATED", "SHOWING_UPDATED", "SHOWING_VALIDATED", "SHOWING_ISSUED", "SHOWING_PDF_GENERATED", "SHOWING_SENT", "SHOWING_VIEWED",
  "SHOWING_SIGNED", "SHOWING_DECLINED", "SHOWING_EXPIRED", "SHOWING_CANCELLED", "SHOWING_REPLACED", "SHOWING_PDF_DOWNLOADED",
  "MANDATE_CREATED", "MANDATE_UPDATED", "MANDATE_VALIDATED", "MANDATE_ISSUED", "MANDATE_PDF_GENERATED", "MANDATE_SENT", "MANDATE_VIEWED", "MANDATE_SIGNED", "MANDATE_DECLINED",
  "MANDATE_CANCELLED", "MANDATE_REPLACED", "MANDATE_EXTENDED", "MANDATE_PDF_DOWNLOADED",
  "EXTENSION_ISSUED", "EXTENSION_PDF_GENERATED", "EXTENSION_SENT", "EXTENSION_VIEWED", "EXTENSION_SIGNED", "EXTENSION_CANCELLED", "EXTENSION_PDF_DOWNLOADED",
  "TEMPLATE_RESOLVED", "TEMPLATE_CHECKSUM_VERIFIED", "TEMPLATE_LEGAL_APPROVED", "TEMPLATE_SUBMITTED_FOR_REVIEW", "TEMPLATE_ACTIVATED",
  "DOCUMENT_VALIDATION_BLOCKED", "COMMISSION_ANOMALY_ACKNOWLEDGED", "EXCLUSIVE_CONFLICT_DETECTED", "EXCLUSIVE_CONFLICT_OVERRIDE_APPROVED",
  "DOCUMENT_STORAGE_PENDING", "DOCUMENT_STORAGE_CONFIRMED", "DOCUMENT_VERIFIED",
] as const;
export type DocumentAuditType = (typeof DOCUMENT_AUDIT_EVENTS)[number];
export type AuditEntityType = "SHOWING" | "MANDATE" | "MANDATE_EXTENSION" | "TEMPLATE";

const SENSITIVE_KEY = /(tax.?id|afm|vat.?id|id.?number|identity|address|e-?mail|phone|mobile|iban|dob|birth|password|secret|token|signature(?!Level|Method|Provider)|text|body|snapshot|description|note|comment|authority)/i;
/** Keys that look sensitive but carry only a digest or a storage path. */
const DIGEST_KEY = /(checksum|hash|storagekey)$/i;

/** 9-digit numbers (ΑΦΜ-shaped) and emails inside free text. */
const TAXID_IN_TEXT = /(?<![\dA-Za-z])\d{9}(?![\dA-Za-z])/g;
const EMAIL_IN_TEXT = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

export function maskAuditPayload(value: unknown, depth = 0, key = ""): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => maskAuditPayload(v, depth + 1, key));
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) && !DIGEST_KEY.test(k) ? "[masked]" : maskAuditPayload(v, depth + 1, k);
    }
    return out;
  }
  if (typeof value === "string") {
    // Checksums and keys are hex or paths: leave them alone. Free text is scrubbed.
    if (DIGEST_KEY.test(key)) return value;
    return value.replace(EMAIL_IN_TEXT, "[masked]").replace(TAXID_IN_TEXT, "[masked]").slice(0, 500);
  }
  return value;
}

export type AuditContext = {
  actorUserId?: string | null;
  actorRole?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type DocumentAuditInput = AuditContext & {
  type: DocumentAuditType;
  entityType: AuditEntityType;
  entityId: string;
  documentNumber?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: unknown;
  occurredAt?: Date;
};

export async function recordDocumentAudit(db: Db, input: DocumentAuditInput): Promise<void> {
  if (!(DOCUMENT_AUDIT_EVENTS as readonly string[]).includes(input.type)) throw new RangeError(`Unknown audit event: ${input.type}`);
  const json = (v: unknown) => (v === undefined || v === null ? undefined : (maskAuditPayload(v) as Prisma.InputJsonValue));
  await db.documentAuditEvent.create({
    data: {
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      documentNumber: input.documentNumber ?? null,
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      before: json(input.before),
      after: json(input.after),
      reason: input.reason ? (maskAuditPayload(input.reason, 0, "reason") as string) : null,
      metadata: json(input.metadata),
    },
  });
}
