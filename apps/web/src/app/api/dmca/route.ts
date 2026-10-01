import { NextResponse } from "next/server";
import type { Prisma } from "@home88/database";

import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { encryptField, hashEmail, hashSubject, redactEmail } from "@/lib/pii";
import {
  AGE_GATE_REFUSAL_MESSAGE,
  dmcaNoticeSchema,
  evaluateAgeGate,
  RATE_LIMITS,
} from "@home88/validation";
import {
  badRequest,
  contextFrom,
  fieldErrors,
  looksAutomated,
  readJson,
  serverError,
  silentAccept,
  unavailable,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Copyright notice endpoint.
 *
 * A DMCA-style notice is a legal document, so it is stored as a DmcaNotice
 * with its own reference and its own status workflow — not folded into a
 * generic lead. The age gate still applies because the form collects a name
 * and an email, but a refused notice never blocks the person: the page tells
 * them to send it by email instead, which is why the failure response repeats
 * the postal/email contact.
 */
export async function POST(request: Request) {
  const ctx = contextFrom(request);

  const limit = rateLimit(`dmca:${ctx.ip}`, RATE_LIMITS.dmcaNotice);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: "Πολλές υποβολές σε σύντομο διάστημα. Δοκιμάστε ξανά αργότερα." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const raw = body.value;

  if (looksAutomated(raw)) {
    console.warn(`[home88:dmca] automated submission dropped ip=${ctx.ip}`);
    return silentAccept();
  }

  const parsed = dmcaNoticeSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest("Ελέγξτε τα στοιχεία της φόρμας.", fieldErrors(parsed.error.issues));
  }
  const input = parsed.data;

  const decision = evaluateAgeGate({
    dateOfBirth: (raw as Record<string, unknown>).dateOfBirth,
    ageAffirmation: (raw as Record<string, unknown>).ageAffirmation,
  });
  if (!decision.eligible) {
    console.warn(`[home88:dmca] age gate refused ip=${ctx.ip} reason=${decision.reason}`);
    return badRequest(AGE_GATE_REFUSAL_MESSAGE, { dateOfBirth: [AGE_GATE_REFUSAL_MESSAGE] });
  }

  if (!prisma) return unavailable();

  const now = new Date();
  const emailHash = hashEmail(input.claimantEmail);
  const subjectHash = hashSubject(input.claimantEmail);

  try {
    const reference = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const counter = await tx.referenceCounter.upsert({
        where: { scope: "dmca" },
        create: { scope: "dmca", nextValue: 2 },
        update: { nextValue: { increment: 1 } },
        select: { nextValue: true },
      });
      const ref = `DMCA-${String(counter.nextValue - 1).padStart(5, "0")}`;

      let propertyId: string | null = null;
      if (input.propertyReference) {
        const property = await tx.property.findUnique({
          where: { reference: input.propertyReference },
          select: { id: true },
        });
        propertyId = property?.id ?? null;
      }

      const contactId = emailHash
        ? (
            await tx.contact.upsert({
              where: { reference: `DMCA-${subjectHash?.slice(0, 12)}` },
              create: {
                reference: `DMCA-${subjectHash?.slice(0, 12)}`,
                firstName: input.claimantName,
                lastName: "",
                roles: ["OTHER"],
                emailHash,
                emailEncrypted: encryptField(input.claimantEmail),
              },
              update: {},
              select: { id: true },
            })
          ).id
        : null;

      const notice = await tx.dmcaNotice.create({
        data: {
          reference: ref,
          claimantName: input.claimantName,
          claimantEmail: input.claimantEmail,
          claimantAddress: input.claimantAddress ?? null,
          originalWorkUrl: input.originalWorkUrl || null,
          workDescription: input.workDescription,
          infringingUrl: input.infringingUrl || null,
          propertyId,
          contactId,
          goodFaithStatement: input.goodFaithStatement,
          signature: input.signature,
          status: "RECEIVED",
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          entity: "SETTINGS",
          entityId: notice.id,
          action: "DMCA_NOTICE_RECEIVED",
          changes: { reference: ref, hasPropertyLink: propertyId !== null },
          ipAddress: ctx.ip === "unknown" ? null : ctx.ip,
          userAgent: ctx.userAgent,
        },
      });

      return ref;
    });

    console.info(`[home88:dmca] notice ${reference} from ${redactEmail(input.claimantEmail)}`);
    return NextResponse.json({ ok: true, reference }, { status: 201 });
  } catch (error) {
    console.error(
      "[home88:dmca] failed to record notice:",
      error instanceof Error ? error.message : "unknown",
    );
    return serverError();
  }
}
