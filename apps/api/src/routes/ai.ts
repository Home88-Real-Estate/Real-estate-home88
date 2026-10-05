/**
 * AI assistance: drafts for a person to review.
 *
 * What may be sent is fixed by code, not by the caller: property facts come
 * from an allow-list read from the database (never from the request), report
 * summaries are built from the numbers the server just counted, and free text
 * a user adds is refused if it contains an email address, phone number or
 * IBAN. Nothing is stored except who used which feature, when, and the token
 * counts (ai_requests), never the prompt or the answer.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AI_FEATURES,
  REPORT_LABELS,
  buildDescriptionPrompt,
  buildReportSummaryPrompt,
  findPersonalData,
  isReportKind,
  personalDataMessage,
  pickPropertyFacts,
  resolveRange,
  type AiFeatureKey,
  type AiPrompt,
} from "@home88/domain";

import { conflict, forbidden, HttpError, notFound, tooManyRequests, validationFailed } from "../lib/errors";
import { parseInput } from "../lib/http";
import { db } from "../lib/prisma";
import { buildReport, reportDigest } from "../lib/reports";
import { requireAuth, requireRole, roleAtLeast } from "../plugins/auth";
import { AiProviderError, AiRefusedError, FAILURE_MESSAGES, resolveAiProvider } from "../providers/ai";
import { ProviderNotConfiguredError } from "../providers/types";
import { aiConfig, type AiConfig } from "../settings";

const NOTICE = "Πρόχειρο από AI. Ελέγξτε το προσεκτικά πριν το χρησιμοποιήσετε· δεν έχει αποθηκευτεί πουθενά.";

function featureAvailable(cfg: AiConfig, feature: AiFeatureKey): boolean {
  const ready = cfg.enabled && cfg.provider === "anthropic" && Boolean(cfg.model) && cfg.hasKey;
  const allowed = feature === "PROPERTY_DESCRIPTION" ? cfg.allowDescriptions : cfg.allowReportSummaries;
  return ready && allowed;
}

async function gate(feature: AiFeatureKey): Promise<AiConfig> {
  const cfg = await aiConfig();
  if (!cfg.enabled) throw conflict("Ο AI βοηθός δεν είναι ενεργός. Ενεργοποιείται από τους διαχειριστές στις Ρυθμίσεις → AI βοηθός.");
  if (!featureAvailable(cfg, feature)) throw conflict("Αυτή η χρήση του AI βοηθού δεν έχει επιτραπεί ή λείπει η ρύθμιση του παρόχου στις Ρυθμίσεις → AI βοηθός.");
  return cfg;
}

async function record(feature: AiFeatureKey, userId: string, cfg: AiConfig, status: "OK" | "FAILED" | "BLOCKED", extra: { inputTokens?: number | null; outputTokens?: number | null; error?: string } = {}) {
  await db().aiRequest.create({
    data: { feature, userId, provider: cfg.provider ?? "-", model: cfg.model ?? "-", status, inputTokens: extra.inputTokens ?? null, outputTokens: extra.outputTokens ?? null, error: extra.error ?? null },
  });
}

/** Run one draft: rate limit, call the provider, record the use, translate failures. */
async function draft(feature: AiFeatureKey, userId: string, cfg: AiConfig, prompt: AiPrompt) {
  const since = new Date(Date.now() - 3_600_000);
  const used = await db().aiRequest.count({ where: { userId, createdAt: { gte: since }, status: { in: ["OK", "FAILED"] } } });
  if (used >= cfg.hourlyLimitPerUser) {
    await record(feature, userId, cfg, "BLOCKED", { error: "rate_limit" });
    throw tooManyRequests(`Έχετε φτάσει το όριο ${cfg.hourlyLimitPerUser} αιτημάτων AI ανά ώρα.`);
  }
  try {
    const provider = await resolveAiProvider();
    const result = await provider.complete(prompt);
    await record(feature, userId, cfg, "OK", { inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    return { text: result.text, truncated: result.truncated, model: provider.model, notice: NOTICE };
  } catch (error) {
    if (error instanceof AiRefusedError) {
      await record(feature, userId, cfg, "FAILED", { error: "refused" });
      throw validationFailed("Το μοντέλο αρνήθηκε να απαντήσει σε αυτό το αίτημα.");
    }
    if (error instanceof AiProviderError) {
      await record(feature, userId, cfg, "FAILED", { error: error.failure });
      throw new HttpError(502, "ai_provider_error", FAILURE_MESSAGES[error.failure]);
    }
    if (error instanceof ProviderNotConfiguredError) throw conflict("Ο AI βοηθός δεν έχει ρυθμιστεί πλήρως στις Ρυθμίσεις → AI βοηθός.");
    await record(feature, userId, cfg, "FAILED", { error: "unknown" });
    throw error;
  }
}

const descriptionSchema = z
  .object({ propertyId: z.string().min(1).max(40), locale: z.enum(["el", "en"]).default("el"), notes: z.string().trim().max(500).optional() })
  .strict();

const summarySchema = z
  .object({
    kind: z.string().max(30),
    range: z.string().max(20).optional(),
    from: z.string().max(10).optional(),
    to: z.string().max(10).optional(),
    scope: z.enum(["mine", "all"]).optional(),
  })
  .strict();

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  /** What the interface may offer. No settings values, no key. */
  app.get("/ai/status", { preHandler: requireRole("AGENT") }, async () => {
    const cfg = await aiConfig();
    return {
      features: Object.fromEntries(AI_FEATURES.map((f) => [f.key, featureAvailable(cfg, f.key)])) as Record<AiFeatureKey, boolean>,
    };
  });

  app.post("/ai/property-description", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const input = parseInput(descriptionSchema, request.body);
    const cfg = await gate("PROPERTY_DESCRIPTION");

    if (input.notes) {
      const found = findPersonalData(input.notes);
      if (found.length > 0) {
        await record("PROPERTY_DESCRIPTION", actor.id, cfg, "BLOCKED", { error: "personal_data" });
        throw validationFailed(personalDataMessage(found), { notes: [personalDataMessage(found)] });
      }
    }
    const property = await db().property.findUnique({
      where: { id: input.propertyId },
      select: {
        listingType: true, propertyType: true, condition: true, price: true, monthlyRent: true, priceOnRequest: true, area: true, plotArea: true,
        bedrooms: true, bathrooms: true, floor: true, totalFloors: true, yearBuilt: true, yearRenovated: true, heating: true, energyClass: true,
        region: true, city: true, areaName: true, neighborhood: true, parking: true, storage: true, balcony: true, garden: true, pool: true,
        furnished: true, petsAllowed: true, seaView: true, newConstruction: true, hasSolar: true,
      },
    });
    if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");
    const { priceOnRequest, ...rest } = property;
    // A price the office keeps private stays private.
    const facts = pickPropertyFacts(priceOnRequest ? { ...rest, price: null, monthlyRent: null } : rest);
    if (Object.keys(facts).length < 3) throw validationFailed("Το ακίνητο έχει πολύ λίγα στοιχεία για να γραφτεί περιγραφή. Συμπληρώστε τα βασικά χαρακτηριστικά πρώτα.");
    return draft("PROPERTY_DESCRIPTION", actor.id, cfg, buildDescriptionPrompt(facts, input.locale, input.notes));
  });

  app.post("/ai/report-summary", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const input = parseInput(summarySchema, request.body);
    if (!isReportKind(input.kind)) throw notFound("Η αναφορά δεν βρέθηκε.");
    if (!roleAtLeast(actor.role, REPORT_LABELS[input.kind].minRole)) throw forbidden("Η αναφορά είναι διαθέσιμη μόνο σε υπευθύνους.");
    const cfg = await gate("REPORT_SUMMARY");
    const manager = roleAtLeast(actor.role, "MANAGER");
    const now = new Date();
    const range = resolveRange({ key: input.range ?? "month", from: input.from, to: input.to }, now);
    const report = await buildReport(input.kind, range, { all: manager && (input.scope ?? "all") === "all", userId: actor.id }, now);
    return draft("REPORT_SUMMARY", actor.id, cfg, buildReportSummaryPrompt(reportDigest(report)));
  });

  /** Usage for administrators: counts and tokens, never content. */
  app.get("/ai/usage", { preHandler: requireRole("MANAGER") }, async () => {
    const since = new Date(Date.now() - 30 * 24 * 3_600_000);
    const rows = await db().aiRequest.groupBy({ by: ["feature", "status"], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } });
    return {
      days: 30,
      data: rows.map((r) => ({ feature: r.feature, status: r.status, requests: r._count._all, inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0 })),
    };
  });
}
