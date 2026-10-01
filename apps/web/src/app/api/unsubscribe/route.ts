import { NextResponse } from "next/server";
import type { Prisma } from "@home88/database";

import { prisma } from "@/lib/db";
import { hashEmail } from "@/lib/pii";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";
import { rateLimit } from "@/lib/rate-limit";
import { contextFrom, readJson, badRequest, serverError, unavailable } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe.
 *
 * Honours a signed token, records the suppression permanently, and marks the
 * affected contacts and leads as opted out. Suppression is stored independently
 * of the contact row so that deleting the contact does not resurrect the
 * ability to email them.
 */
export async function POST(request: Request) {
  const ctx = contextFrom(request);

  const limit = rateLimit(`unsubscribe:${ctx.ip}`, { points: 20, durationSeconds: 600 });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: "Πολλές προσπάθειες. Δοκιμάστε ξανά αργότερα." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const raw = body.value as Record<string, unknown>;

  const token = typeof raw?.token === "string" ? raw.token : "";
  const reason = typeof raw?.reason === "string" ? raw.reason.slice(0, 500) : null;

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return badRequest("Ο σύνδεσμος δεν είναι έγκυρος ή έχει λήξει.");
  }

  if (!prisma) return unavailable();

  const email = verified.email;
  const emailHash = hashEmail(email);
  if (!emailHash) return badRequest("Ο σύνδεσμος δεν είναι έγκυρος.");

  const now = new Date();

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.emailSuppression.upsert({
        where: { emailHash },
        create: {
          email,
          emailHash,
          reason: "UNSUBSCRIBE",
          source: "website:unsubscribe",
          notes: reason,
        },
        // Re-unsubscribing does not reset the original suppression date.
        update: {},
      });

      const contacts = await tx.contact.findMany({ where: { emailHash }, select: { id: true } });
      if (contacts.length > 0) {
        await tx.contact.updateMany({
          where: { id: { in: contacts.map((c) => c.id) } },
          data: { marketingOptOutAt: now },
        });
        await tx.lead.updateMany({
          where: { contactId: { in: contacts.map((c) => c.id) } },
          data: { marketingOptOutAt: now },
        });
      }
      // Also catch leads recorded before a contact existed.
      await tx.lead.updateMany({
        where: { email, marketingOptOutAt: null },
        data: { marketingOptOutAt: now },
      });

      await tx.auditLog.create({
        data: {
          entity: "CONSENT",
          entityId: emailHash,
          action: "MARKETING_UNSUBSCRIBED",
          changes: { source: "website:unsubscribe" },
          ipAddress: ctx.ip === "unknown" ? null : ctx.ip,
          userAgent: ctx.userAgent,
        },
      });
    });

    // Never confirm or deny whether the address was on a list: the response is
    // identical either way, so the endpoint cannot be used to enumerate.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[home88:unsubscribe] failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return serverError();
  }
}
