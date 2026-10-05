import { NextResponse } from "next/server";
import { RATE_LIMITS, valuationInputSchema } from "@home88/validation";
import { publicView, valuateAndStore } from "@home88/valuation/service";

import { badRequest, contextFrom, fieldErrors, looksAutomated, readJson, serverError, unavailable } from "@/lib/api";
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
export async function POST(request: Request) {
  const ctx = contextFrom(request);
  const limit = rateLimit(`valuation-estimate:${ctx.ip}`, RATE_LIMITS.valuationEstimate);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: "Πολλές εκτιμήσεις σε σύντομο διάστημα. Δοκιμάστε ξανά σε λίγα λεπτά." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const raw = (body.value ?? {}) as Record<string, unknown>;
  if (looksAutomated(raw)) return badRequest("Μη έγκυρο αίτημα.");

  const parsed = valuationInputSchema.safeParse(raw);
  if (!parsed.success) return badRequest("Ελέγξτε τα στοιχεία του ακινήτου.", fieldErrors(parsed.error.issues));
  if (!prisma) return unavailable();

  try {
    const stored = await valuateAndStore(prisma, subjectFromInput(parsed.data), {
      channel: "WEBSITE",
      idempotencyKey: parsed.data.idempotencyKey ?? null,
    });
    return NextResponse.json({ ok: true, requestId: stored.id, valuation: publicView(stored.result) });
  } catch (error) {
    console.error("[home88:valuation-estimate] failed:", error instanceof Error ? error.constructor.name : "unknown");
    return serverError();
  }
}
