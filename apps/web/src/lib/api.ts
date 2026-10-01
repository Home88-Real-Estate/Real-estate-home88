import { NextResponse } from "next/server";

import { clientIp } from "@/lib/rate-limit";

export const MAX_BODY_BYTES = 64 * 1024;
/** A human cannot read a form and type a name in under this long. */
export const MIN_COMPLETION_MS = 2000;

export type RequestContext = {
  ip: string;
  userAgent: string | null;
};

export function contextFrom(request: Request): RequestContext {
  return {
    ip: clientIp(request.headers),
    userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
  };
}

export function badRequest(message: string, fields?: Record<string, string[]>) {
  return NextResponse.json({ ok: false, message, fields }, { status: 400 });
}

export function incompleteBody() {
  return badRequest("Μη έγκυρο αίτημα.");
}

export function tooLarge() {
  return badRequest("Το αίτημα είναι πολύ μεγάλο.");
}

/**
 * A bot that tripped the honeypot or the time trap gets the same shape of
 * success a human gets. Telling it that it failed only teaches it to retry
 * more convincingly.
 */
export function silentAccept() {
  return NextResponse.json({ ok: true, reference: null }, { status: 200 });
}

export function serverError() {
  return NextResponse.json(
    { ok: false, message: "Η υποβολή δεν ολοκληρώθηκε. Δοκιμάστε ξανά σε λίγο." },
    { status: 500 },
  );
}

export function unavailable() {
  return NextResponse.json(
    {
      ok: false,
      message: "Η υπηρεσία δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά αργότερα.",
    },
    { status: 503 },
  );
}

/**
 * Reads and size-checks the JSON body. Returns a sentinel instead of throwing
 * so each route can map the three failure modes to the same responses.
 */
export async function readJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return { ok: false, response: tooLarge() };

  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false, response: tooLarge() };
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: incompleteBody() };
  }
}

/**
 * Shared bot checks, run against the raw JSON before validation so a crafted
 * shape cannot evade them by failing schema validation on a different branch.
 */
export function looksAutomated(raw: unknown): boolean {
  const obj = (raw ?? {}) as Record<string, unknown>;

  const honeypot = obj.hpl ?? obj.website;
  if (typeof honeypot === "string" && honeypot.trim().length > 0) return true;

  const submittedAt = Number(obj.hpt ?? "0");
  if (Number.isFinite(submittedAt) && submittedAt > 0) {
    const elapsed = Date.now() - submittedAt;
    // Negative means a forged or clock-skewed value; treat it as a bot too.
    if (elapsed < MIN_COMPLETION_MS) return true;
  }

  return false;
}

/** Maps Zod issues to the `{ field: [message] }` shape the forms render. */
export function fieldErrors(issues: Array<{ path: (string | number)[]; message: string }>) {
  const fields: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}
