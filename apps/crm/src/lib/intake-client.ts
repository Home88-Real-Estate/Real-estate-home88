"use client";

import { CRM_BASE_PATH } from "@/lib/paths";

/** What the property intake API returns for a session (see apps/api/src/lib/property-intake/service.ts). */
export type IntakeOrigin = "AGENT_STATED" | "AGENT_MANUAL" | "SYSTEM_DERIVED" | "AI_SUGGESTED";
export type IntakeTurn = { role: "agent" | "assistant"; text: string; at: string; lang?: "el" | "en" };
export type IntakeReviewRow = { key: string; label: string; display: string; origin: IntakeOrigin; confirmed: boolean; needsConfirmation: boolean };
export type IntakeSession = {
  id: string;
  status: "ACTIVE" | "CREATED" | "ABANDONED";
  language: "auto" | "el" | "en";
  revision: number;
  propertyId: string | null;
  stage: "collect" | "review";
  muted: boolean;
  photosLater: boolean;
  owner: { contactId: string; reference: string; label: string } | null;
  lang: "el" | "en";
  turns: IntakeTurn[];
  pending: Array<{ key: string; label: string; proposed: string; current: string | null; reason: "conflict" | "unverified" }>;
  asked: { key: string; label: string; kind: string; options?: Array<{ value: string; label: string }> } | null;
  review: { rows: IntakeReviewRow[]; blockers: string[]; warnings: string[]; missing: string[]; ignored: string[]; ready: boolean };
  fields: Record<string, { value: string | number | boolean; origin: IntakeOrigin; confirmed: boolean }>;
  catalog: Array<{ key: string; label: string; kind: string; unit?: string; options?: Array<{ value: string; label: string }> }>;
};

export type IntakeEdit =
  | { type: "set"; key: string; value: string | number | boolean }
  | { type: "clear"; key: string }
  | { type: "confirm"; key: string }
  | { type: "resolve"; key: string; accept: boolean }
  | { type: "skip"; key: string }
  | { type: "undo" }
  | { type: "owner"; contactId: string | null }
  | { type: "settings"; muted?: boolean; photosLater?: boolean; language?: "auto" | "el" | "en"; stage?: "collect" | "review" };

export type OwnerCandidate = { id: string; reference: string; name: string; city: string | null; roles: string[]; phoneHint: string | null };
export type PhotoLabelSuggestion = { id: string; label: string; labelEl: string; labelEn: string; confidence: "high" | "medium" | "low" };

/** A failure the screen can show: a calm message, plus whether trying again can help. */
export class IntakeRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly retryable: boolean) {
    super(message);
    this.name = "IntakeRequestError";
  }
}

const base = `${CRM_BASE_PATH}/api/property-intake`;
const NETWORK = "Δεν υπάρχει σύνδεση. Ό,τι έχει ήδη σταλεί είναι αποθηκευμένο· δοκιμάστε ξανά όταν επανέλθει το σήμα.";

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      credentials: "same-origin",
      headers: { accept: "application/json", ...(init?.body === undefined ? {} : { "content-type": "application/json" }) },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new IntakeRequestError(NETWORK, 0, "network", true);
  }
  const data = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    throw new IntakeRequestError(data?.error?.message ?? `Σφάλμα ${response.status}`, response.status, data?.error?.code ?? "error", retryable);
  }
  return data as T;
}

export const intakeApi = {
  status: () => request<{ available: boolean; maxAudioBytes: number; maxUtteranceChars: number }>("/status"),
  list: () => request<{ sessions: Array<{ id: string; updatedAt: string; fieldCount: number; summary: string | null }> }>("/sessions"),
  start: (language: "auto" | "el" | "en") => request<{ session: IntakeSession }>("/sessions", { body: { language } }),
  get: (id: string) => request<{ session: IntakeSession }>(`/sessions/${id}`),
  transcribe: (id: string, audioBase64: string, mimeType: string, language: "auto" | "el" | "en") =>
    request<{ text: string; language: "el" | "en" | null }>(`/sessions/${id}/transcribe`, { body: { audio: audioBase64, mimeType, language } }),
  turn: (id: string, text: string, revision: number, detectedLanguage?: "el" | "en" | null) =>
    request<{ session: IntakeSession; reply: string; changed: boolean }>(`/sessions/${id}/turn`, { body: { text, revision, detectedLanguage: detectedLanguage ?? null } }),
  edit: (id: string, edit: IntakeEdit, revision?: number) => request<{ session: IntakeSession }>(`/sessions/${id}/edit`, { body: { edit, revision } }),
  suggest: (id: string) => request<{ session: IntakeSession }>(`/sessions/${id}/suggest`, { body: {} }),
  speak: (id: string) => request<{ audio: string | null; mimeType?: string; muted: boolean }>(`/sessions/${id}/speak`, { body: {} }),
  create: (id: string, revision?: number) =>
    request<{ session: IntakeSession; property: { id: string; reference: string }; alreadyCreated: boolean; owner: "linked" | "skipped" | "none" }>(`/sessions/${id}/create`, { body: { revision } }),
  searchContacts: (q: string) => request<{ contacts: OwnerCandidate[] }>(`/contacts?q=${encodeURIComponent(q)}`),
  labelPhotos: (id: string, images: Array<{ id: string; mimeType: "image/jpeg"; data: string }>) =>
    request<{ labels: PhotoLabelSuggestion[] }>(`/sessions/${id}/label-photos`, { body: { images } }),
  abandon: (id: string) => request<{ session: IntakeSession }>(`/sessions/${id}/abandon`, { body: {} }),
};
