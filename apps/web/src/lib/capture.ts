import type { Prisma } from "@home88/database";

import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { encryptField, hashEmail, hashSubject } from "@/lib/pii";
import { evaluateAgeGate, type AgeGateInput } from "@home88/validation";

/**
 * The one path by which personal data enters the system from a public form.
 *
 * Every public endpoint funnels through here. That is deliberate: the age gate
 * and the "nothing is written on refusal" rule live in exactly one place, so a
 * new endpoint cannot forget them. A route that wants to record an enquiry has
 * no way to skip the gate — there is no second insert path.
 */

export const LEAD_RETENTION_MONTHS = 24;

export type CaptureKind = "LEAD" | "DMCA";

export type CaptureSubject = {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  propertyReference?: string | null;
  preferredContactMethod?: "PHONE" | "EMAIL" | "WHATSAPP" | "SMS" | "ANY";
  locale?: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  source?: string;
  sourceUrl?: string | null;
  /** Extra lead columns for non-lead submissions (e.g. DMCA metadata). */
  extraLeadData?: Record<string, unknown>;
};

export type CaptureContext = {
  kind: CaptureKind;
  age: AgeGateInput;
  consent?: { necessary: true; analytics?: boolean; marketing?: boolean } | undefined;
  ip: string;
  userAgent: string | null;
  /** Overrides for the default website:lead-form marker. */
  consentSource?: string;
};

export type CaptureOutcome =
  | { status: "refused"; reason: string }
  | { status: "unavailable" }
  | { status: "created"; reference: string; id: string; ageMethod: string }
  | { status: "failed" };

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

async function allocateReference(
  tx: Prisma.TransactionClient,
  scope: string,
  prefix: string,
  width = 6,
): Promise<string> {
  const counter = await tx.referenceCounter.upsert({
    where: { scope },
    create: { scope, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });
  return `${prefix}-${String(counter.nextValue - 1).padStart(width, "0")}`;
}

export async function recordCapture(
  subject: CaptureSubject,
  ctx: CaptureContext,
): Promise<CaptureOutcome> {
  // ---- Age gate first, before touching the database at all ----------------
  const decision = evaluateAgeGate(ctx.age);
  if (!decision.eligible) {
    // Log the reason only. Not the name, not the address, not the birth date.
    return { status: "refused", reason: decision.reason };
  }

  if (!prisma) {
    console.error("[home88:capture] DATABASE_URL not configured; cannot record.");
    return { status: "unavailable" };
  }

  const now = new Date();
  const email = subject.email ? subject.email.trim().toLowerCase() : null;
  const emailHash = hashEmail(email);
  const subjectHash = hashSubject(email ?? subject.phone ?? null);

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const suppressed = emailHash
        ? await tx.emailSuppression.findUnique({ where: { emailHash }, select: { id: true } })
        : null;

      let propertyId: string | null = null;
      if (subject.propertyReference) {
        const property = await tx.property.findUnique({
          where: { reference: subject.propertyReference.toUpperCase() },
          select: { id: true },
        });
        propertyId = property?.id ?? null;
      }

      let contactId: string | null = null;
      if (emailHash) {
        const existing = await tx.contact.findFirst({ where: { emailHash }, select: { id: true } });
        if (existing) {
          contactId = existing.id;
        } else {
          const contact = await tx.contact.create({
            data: {
              reference: await allocateReference(tx, "contact", "C"),
              firstName: subject.firstName,
              lastName: subject.lastName ?? "",
              roles: ctx.kind === "DMCA" ? ["OTHER"] : ["BUYER"],
              preferredContactMethod: subject.preferredContactMethod ?? "ANY",
              preferredLocale: subject.locale ?? "el",
              emailHash,
              emailEncrypted: encryptField(email),
              phoneEncrypted: encryptField(subject.phone),
              retentionExpiresAt: addMonths(now, LEAD_RETENTION_MONTHS),
            },
            select: { id: true },
          });
          contactId = contact.id;
        }
      }

      const consentRecord =
        subjectHash && ctx.consent
          ? await tx.consentRecord.create({
              data: {
                subjectHash,
                email,
                purpose: "MARKETING",
                granted: ctx.consent.marketing === true,
                policyVersion: COMPANY.policyVersion,
                source: ctx.consentSource ?? "website:lead-form",
                ipAddress: ctx.ip === "unknown" ? null : ctx.ip,
                userAgent: ctx.userAgent,
                grantedAt: ctx.consent.marketing ? now : null,
                revokedAt: ctx.consent.marketing ? null : now,
              },
              select: { id: true },
            })
          : null;

      const scope = ctx.kind === "DMCA" ? "dmca" : "lead";
      const prefix = ctx.kind === "DMCA" ? "DMCA" : "H88";
      const reference = await allocateReference(tx, scope, prefix, ctx.kind === "DMCA" ? 5 : 6);

      const lead = await tx.lead.create({
        data: {
          reference,
          firstName: subject.firstName,
          lastName: subject.lastName ?? null,
          email,
          phone: subject.phone ?? null,
          message: subject.message ?? null,
          status: "NEW",
          source: (subject.source as never) ?? "WEBSITE",
          sourceUrl: subject.sourceUrl ?? null,
          preferredContactMethod: subject.preferredContactMethod ?? "ANY",
          locale: subject.locale ?? "el",
          budgetMin: subject.budgetMin ?? null,
          budgetMax: subject.budgetMax ?? null,
          propertyId,
          contactId,
          consentRecordId: consentRecord?.id ?? null,
          marketingOptOutAt: suppressed ? now : null,
          retentionExpiresAt: addMonths(now, LEAD_RETENTION_MONTHS),
          ageVerifiedAt: now,
          ageVerificationFail: false,
          ...(subject.extraLeadData ?? {}),
        },
        select: { id: true, reference: true },
      });

      await tx.auditLog.create({
        data: {
          entity: "LEAD",
          entityId: lead.id,
          action: ctx.kind === "DMCA" ? "DMCA_NOTICE_CREATED" : "LEAD_CREATED",
          changes: {
            source: subject.source ?? "website",
            ageGateMethod: decision.method,
            hasPropertyLink: propertyId !== null,
          },
          ipAddress: ctx.ip === "unknown" ? null : ctx.ip,
          userAgent: ctx.userAgent,
        },
      });

      return { id: lead.id, reference: lead.reference, ageMethod: decision.method };
    });

    return { status: "created", ...result };
  } catch (error) {
    console.error(
      "[home88:capture] failed to record:",
      error instanceof Error ? error.message : "unknown",
    );
    return { status: "failed" };
  }
}
