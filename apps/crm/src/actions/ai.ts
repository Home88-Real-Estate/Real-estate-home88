"use server";

/** AI drafts: every call goes to the API, which decides what may be sent and records the use. Nothing is saved here. */

import { apiFetch } from "@/lib/api";

export type AiDraft = { ok: boolean; text?: string; notice?: string; truncated?: boolean; model?: string; message?: string; fields?: Record<string, string[]> };

type Draft = { text: string; notice: string; truncated: boolean; model: string };

export async function draftDescription(propertyId: string, locale: "el" | "en", notes: string): Promise<AiDraft> {
  const r = await apiFetch<Draft>("/api/ai/property-description", { method: "POST", json: { propertyId, locale, ...(notes.trim() ? { notes: notes.trim() } : {}) } });
  if (!r.ok) return { ok: false, message: r.error.message, fields: r.error.fields };
  return { ok: true, ...r.data };
}

export async function summariseReport(kind: string, query: { range?: string; from?: string; to?: string; scope?: string }): Promise<AiDraft> {
  const scope = query.scope === "mine" || query.scope === "all" ? query.scope : undefined;
  const r = await apiFetch<Draft>("/api/ai/report-summary", { method: "POST", json: { kind, range: query.range || undefined, from: query.from || undefined, to: query.to || undefined, scope } });
  if (!r.ok) return { ok: false, message: r.error.message };
  return { ok: true, ...r.data };
}
