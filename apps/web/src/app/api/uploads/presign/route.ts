import { NextResponse } from "next/server";
import { presignUpload, UploadRefused } from "@home88/intake";
import { RATE_LIMITS, uploadPresignSchema } from "@home88/validation";

import { badRequest, contextFrom, fieldErrors, readJson, serverError, unavailable } from "@/lib/api";
import { intakeLimits, intakeStorage } from "@/lib/intake";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A signed URL for one file, issued against an upload session. Type, name and
 * size are checked and the session's quota is reserved before any URL exists.
 * The response never contains a readable URL: quarantine objects are write-only
 * to the visitor.
 */
export async function POST(request: Request) {
  const ctx = contextFrom(request);
  const limit = rateLimit(`upload-presign:${ctx.ip}`, RATE_LIMITS.uploadPresign);
  if (!limit.ok) {
    return NextResponse.json({ ok: false, message: "Πολλές προσπάθειες. Δοκιμάστε ξανά αργότερα." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const storage = intakeStorage();
  if (!prisma || !storage) return unavailable();

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = uploadPresignSchema.safeParse(body.value);
  if (!parsed.success) return badRequest("Μη έγκυρο αρχείο.", fieldErrors(parsed.error.issues));
  const { token, ...declared } = parsed.data;

  try {
    const out = await presignUpload({ prisma, storage, limits: intakeLimits() }, token, declared);
    return NextResponse.json({ ok: true, storageKey: out.storageKey, upload: out.upload });
  } catch (error) {
    if (error instanceof UploadRefused) {
      return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.code === "SESSION_INVALID" ? 401 : 400 });
    }
    console.error("[home88:upload-presign] failed:", error instanceof Error ? error.constructor.name : "unknown");
    return serverError();
  }
}
