import { NextResponse } from "next/server";
import { createUploadSession } from "@home88/intake";
import { RATE_LIMITS } from "@home88/validation";

import { contextFrom, unavailable } from "@/lib/api";
import { intakeLimits, intakeStorage } from "@/lib/intake";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts an anonymous upload session. The token is shown once and only its hash is kept. */
export async function POST(request: Request) {
  const ctx = contextFrom(request);
  const limit = rateLimit(`upload-session:${ctx.ip}`, RATE_LIMITS.uploadSession);
  if (!limit.ok) {
    return NextResponse.json({ ok: false, message: "Πολλές προσπάθειες. Δοκιμάστε ξανά αργότερα." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  if (!prisma || !intakeStorage()) return unavailable();

  const session = await createUploadSession(prisma);
  const l = intakeLimits();
  return NextResponse.json({
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    limits: { maxPhotos: l.maxPhotos, maxDocuments: l.maxDocuments, maxPhotoBytes: l.maxPhotoBytes, maxDocumentBytes: l.maxDocumentBytes },
  });
}
