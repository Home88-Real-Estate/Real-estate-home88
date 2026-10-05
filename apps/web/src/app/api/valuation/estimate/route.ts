import { NextResponse } from "next/server";
import { RATE_LIMITS, valuationInputSchema } from "@home88/validation";
import { ValuationFailure, errorCode, publicView, valuateAndStore } from "@home88/valuation/service";

import { contextFrom, fieldErrors, looksAutomated, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { subjectFromInput } from "@/lib/valuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Indicative valuation. No personal data: just the property. The result is
 * computed and stored server-side (request + frozen comparable snapshot); the
 * response carries only the public view and an opaque handle the visitor can
 * use to ask for a full valuation.
 */
/** Structured error codes. The message is safe to show; details stay in the server log. */
type ErrorCode = "VALIDATION_ERROR" | "RATE_LIMITED" | "DATABASE_ERROR" | "VALUATION_ENGINE_ERROR" | "UNKNOWN_ERROR";
function fail(code: ErrorCode, message: string, status: number, extra: Record<string, unknown> = {}, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, code, message, ...extra }, { status, headers });
}
const TEMPORARY = "Ο υπολογισμός δεν είναι διαθέσιμος αυτή τη στιγμή λόγω τεχνικού προβλήματος. Δοκιμάστε ξανά σε λίγο ή ζητήστε εκτίμηση από σύμβουλο HOME88.";

export async function POST(request: Request) {
  const ctx = contextFrom(request);
  const limit = rateLimit(`valuation-estimate:${ctx.ip}`, RATE_LIMITS.valuationEstimate);
  if (!limit.ok) {
    return fail("RATE_LIMITED", "Πολλές εκτιμήσεις σε σύντομο διάστημα. Δοκιμάστε ξανά σε λίγα λεπτά.", 429, {}, { "Retry-After": String(limit.retryAfterSeconds) });
  }
  const body = await readJson(request);
  if (!body.ok) return fail("VALIDATION_ERROR", "Μη έγκυρο αίτημα.", 400);
  const raw = (body.value ?? {}) as Record<string, unknown>;
  if (looksAutomated(raw)) return fail("VALIDATION_ERROR", "Μη έγκυρο αίτημα.", 400);

  const parsed = valuationInputSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Ελέγξτε τα στοιχεία του ακινήτου.", 400, { fields: fieldErrors(parsed.error.issues) });
  if (!prisma) {
    console.error("[home88:valuation-estimate] DATABASE_ERROR: DATABASE_URL not configured");
    return fail("DATABASE_ERROR", TEMPORARY, 503);
  }
  const propertyType = parsed.data.propertyType;

  try {
    const stored = await valuateAndStore(prisma, subjectFromInput(parsed.data), {
      channel: "WEBSITE",
      idempotencyKey: parsed.data.idempotencyKey ?? null,
    });
    // persisted=false: the result was computed but could not be stored (logged as SNAPSHOT_ERROR).
    return NextResponse.json({ ok: true, requestId: stored.id, persisted: stored.id !== null, valuation: publicView(stored.result) });
  } catch (error) {
    // Log the stage and the database/engine code only: no input values, no personal data, no stack to the client.
    if (error instanceof ValuationFailure) {
      console.error(`[home88:valuation-estimate] ${error.code} stage=${error.stage} cause=${errorCode(error.cause)} type=${propertyType}`);
      const code = error.code === "VALUATION_ENGINE_ERROR" ? "VALUATION_ENGINE_ERROR" : "DATABASE_ERROR";
      return fail(code, TEMPORARY, 503);
    }
    console.error(`[home88:valuation-estimate] UNKNOWN_ERROR cause=${errorCode(error)} type=${propertyType}`);
    return fail("UNKNOWN_ERROR", TEMPORARY, 500);
  }
}
