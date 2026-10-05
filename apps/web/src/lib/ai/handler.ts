import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { runChat, sanitiseHistory } from "@/lib/ai/chat";
import { aiConfig } from "@/lib/ai/config";
import { AiNotConfiguredError, AiProviderError, createGeminiLlm, type LlmPort } from "@/lib/ai/llm";
import type { ToolDeps } from "@/lib/ai/tools";
import { contextFrom } from "@/lib/api";
import { getCompanyInfo } from "@/lib/company";
import { intakeService } from "@/lib/intake";
import { getPropertyByReference, searchProperties } from "@/lib/property";
import { rateLimit } from "@/lib/rate-limit";
import { COMPANY } from "@/lib/config";

/** The request is a sentence, not a form: much smaller than the 64 KB intake cap. */
const MAX_BODY_BYTES = 24 * 1024;

const FALLBACK =
  "Συγγνώμη, αντιμετωπίζω προσωρινά ένα τεχνικό πρόβλημα. Μπορείτε να δοκιμάσετε ξανά ή να επικοινωνήσετε με τη HOME88 μέσω της σελίδας επικοινωνίας.";

function reply(body: Record<string, unknown>, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export type ChatRouteDeps = {
  llm: () => LlmPort;
  tools: ToolDeps;
  config: ReturnType<typeof aiConfig>;
};

export const defaultDeps = (): ChatRouteDeps => {
  const config = aiConfig();
  return {
    config,
    llm: () => createGeminiLlm(config),
    tools: { searchProperties, getProperty: getPropertyByReference, intake: intakeService, company: getCompanyInfo, rateLimit },
  };
};

export async function handleChat(request: Request, deps: ChatRouteDeps): Promise<NextResponse> {
  const requestId = randomUUID().slice(0, 8);
  const ctx = contextFrom(request);
  const { config } = deps;

  const limit = rateLimit(`ai-chat:${ctx.ip}`, config.rateLimit);
  if (!limit.ok) {
    return reply(
      { ok: false, message: "Στείλατε πολλά μηνύματα σε σύντομο διάστημα. Δοκιμάστε ξανά σε λίγο." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  // Size-check before parsing: an anonymous caller must not make us read megabytes.
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return reply({ ok: false, message: "Το μήνυμα είναι πολύ μεγάλο." }, 413);
  }
  let raw: Record<string, unknown>;
  try {
    const bodyText = await request.text();
    if (bodyText.length > MAX_BODY_BYTES) return reply({ ok: false, message: "Το μήνυμα είναι πολύ μεγάλο." }, 413);
    const parsed = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    raw = parsed as Record<string, unknown>;
  } catch {
    return reply({ ok: false, message: "Μη έγκυρο αίτημα." }, 400);
  }

  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  if (message.length === 0) return reply({ ok: false, message: "Γράψτε ένα μήνυμα." }, 400);
  if (message.length > config.maxMessageChars) {
    return reply({ ok: false, message: `Το μήνυμα δεν μπορεί να ξεπερνά τους ${config.maxMessageChars} χαρακτήρες.` }, 400);
  }
  const sessionId = typeof raw.sessionId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(raw.sessionId) ? raw.sessionId : null;
  if (!sessionId) return reply({ ok: false, message: "Μη έγκυρο αίτημα." }, 400);

  // The key is a deployment setting. Say so in the server log, not to the visitor.
  if (!config.apiKey) {
    console.error(`[home88:ai] req=${requestId} GEMINI_API_KEY is not configured; set it in the server environment.`);
    return reply({ ok: false, unavailable: true, message: FALLBACK, sessionId }, 503);
  }

  const locale = raw.locale === "en" ? "en" : "el";

  // The page the chat was opened on is a hint; the property is only believed if it is real and public.
  let currentProperty: { reference: string } | null = null;
  const ref = typeof raw.propertyReference === "string" ? raw.propertyReference.trim().toUpperCase() : "";
  if (/^H88-\d{6}$/.test(ref)) {
    const found = await deps.tools.getProperty(ref, locale);
    if (found) currentProperty = { reference: found.reference };
  }
  const pageUrl = typeof raw.pageUrl === "string" && raw.pageUrl.startsWith("/") ? raw.pageUrl.slice(0, 300) : undefined;

  try {
    const company = await deps.tools.company().catch(() => null);
    const result = await runChat(
      { llm: deps.llm(), config, secrets: config.apiKey ? [config.apiKey] : [] },
      {
        message,
        history: sanitiseHistory(raw.history, config),
        requestId,
        companyName: company?.name ?? COMPANY.legalName,
        ctx: { locale, sessionId, ip: ctx.ip, userAgent: ctx.userAgent, currentProperty, landingPage: pageUrl, deps: deps.tools },
      },
    );
    return reply({ ok: true, sessionId, ...result, leadCreated: result.actions.length > 0 });
  } catch (error) {
    const category = error instanceof AiNotConfiguredError ? "not_configured" : error instanceof AiProviderError ? error.category : "unexpected";
    console.error(`[home88:ai] req=${requestId} failed category=${category}`);
    return reply({ ok: false, unavailable: true, message: FALLBACK, sessionId }, category === "timeout" ? 504 : 503);
  }
}

