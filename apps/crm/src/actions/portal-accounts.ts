"use server";

import { revalidatePath } from "next/cache";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

const ENVIRONMENTS = ["TEST", "PRODUCTION"];

function environmentOf(formData: FormData): "TEST" | "PRODUCTION" | undefined {
  const v = str(formData, "environment");
  return v && ENVIRONMENTS.includes(v) ? (v as "TEST" | "PRODUCTION") : undefined;
}

const done = (code: string) => revalidatePath(`/settings/portals/${code}`);

export async function createPortalAccount(_p: ActionState, formData: FormData): Promise<ActionState> {
  const code = str(formData, "code") ?? "";
  const environment = environmentOf(formData);
  if (!environment) return { ok: false, message: "Επιλέξτε περιβάλλον: TEST ή PRODUCTION." };
  const result = await apiFetch(`/api/portals/${encodeURIComponent(code)}/accounts`, {
    method: "POST",
    json: { accountName: str(formData, "accountName") ?? "", environment, agencyExternalId: str(formData, "agencyExternalId") ?? null, endpointUrl: str(formData, "endpointUrl") ?? null },
  });
  if (!result.ok) return { ok: false, message: result.error.message, fields: result.error.fields };
  done(code);
  return { ok: true, message: "Ο λογαριασμός δημιουργήθηκε. Ορίστε διαπιστευτήρια και ελέγξτε τη σύνδεση." };
}

/** Values are sent to the server once and sealed there; nothing comes back but the masked summary. */
export async function saveAccountCredentials(_p: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id") ?? "";
  const code = str(formData, "code") ?? "";
  const secrets: Record<string, string> = {};
  const clear: string[] = [];
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (key.startsWith("secret.") && value.trim()) secrets[key.slice(7)] = value.trim();
    if (key.startsWith("clear.")) clear.push(key.slice(6));
  }
  if (Object.keys(secrets).length === 0 && clear.length === 0) return { ok: false, message: "Δεν δόθηκε νέα τιμή." };
  const result = await apiFetch(`/api/portal-accounts/${encodeURIComponent(id)}/credentials`, { method: "PUT", json: { secrets, clear } });
  if (!result.ok) return { ok: false, message: result.error.message };
  done(code);
  return { ok: true, message: "Τα διαπιστευτήρια αποθηκεύτηκαν. Ελέγξτε ξανά τη σύνδεση πριν ενεργοποιήσετε τον λογαριασμό." };
}

export async function testAccountConnection(_p: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id") ?? "";
  const code = str(formData, "code") ?? "";
  const environment = environmentOf(formData);
  if (!environment) return { ok: false, message: "Λείπει το περιβάλλον." };
  const result = await apiFetch<{ ok: boolean; mock: boolean; message?: string }>(`/api/portal-accounts/${encodeURIComponent(id)}/test`, { method: "POST", json: { environment } });
  done(code);
  if (!result.ok) return { ok: false, message: result.error.message };
  if (!result.data.ok) return { ok: false, message: result.data.message ?? "Η σύνδεση απέτυχε." };
  return { ok: true, message: result.data.mock ? "Η δοκιμή πέρασε (mock: δεν έγινε επικοινωνία με πραγματικό portal)." : "Η σύνδεση ολοκληρώθηκε." };
}

export async function setAccountEnabled(_p: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id") ?? "";
  const code = str(formData, "code") ?? "";
  const result = await apiFetch(`/api/portal-accounts/${encodeURIComponent(id)}`, { method: "PATCH", json: { enabled: str(formData, "enabled") === "1" } });
  if (!result.ok) return { ok: false, message: result.error.message };
  done(code);
  return { ok: true, message: str(formData, "enabled") === "1" ? "Ο λογαριασμός ενεργοποιήθηκε." : "Ο λογαριασμός τέθηκε σε παύση." };
}

export async function setAccountMockMode(_p: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id") ?? "";
  const code = str(formData, "code") ?? "";
  const mode = str(formData, "mockMode");
  const result = await apiFetch(`/api/portal-accounts/${encodeURIComponent(id)}`, { method: "PATCH", json: { mockMode: mode && mode !== "success" ? mode : null } });
  if (!result.ok) return { ok: false, message: result.error.message };
  done(code);
  return { ok: true, message: "Η λειτουργία δοκιμής ενημερώθηκε." };
}

export type OperationState = ActionState & {
  preview?: { outcome: string; reasons: string[]; warnings: string[]; providerErrors: string[]; hash: string; externalId: string; contentType: string; body: string; mock: boolean; mediaCount: number };
};

type OperationResponse = { status: string; message?: string; reasons?: string[]; mock?: boolean } & NonNullable<OperationState["preview"]> & { errorCode?: string };

const DONE_TEXT: Record<string, string> = {
  PUBLISHED: "Το ακίνητο δημοσιεύτηκε.",
  UPDATED: "Η αγγελία ενημερώθηκε.",
  UNPUBLISHED: "Η αγγελία αποσύρθηκε.",
  UNCHANGED: "Δεν υπάρχει αλλαγή από την τελευταία αποστολή· δεν στάλθηκε τίποτα.",
};

export async function portalOperation(_p: OperationState, formData: FormData): Promise<OperationState> {
  const propertyId = str(formData, "propertyId") ?? "";
  const code = str(formData, "code") ?? "";
  const op = str(formData, "op") ?? "";
  const environment = environmentOf(formData);
  if (!["preview", "publish", "update", "unpublish", "retry"].includes(op)) return { ok: false, message: "Άγνωστη ενέργεια." };
  if (!environment) return { ok: false, message: "Επιλέξτε λογαριασμό." };
  const result = await apiFetch<OperationResponse>(`/api/properties/${encodeURIComponent(propertyId)}/portals/${encodeURIComponent(code)}/${op}`, {
    method: "POST",
    json: { accountId: str(formData, "accountId") ?? "", environment },
  });
  revalidatePath(`/properties/${propertyId}`);
  if (!result.ok) return { ok: false, message: result.error.message };
  const d = result.data;
  if (d.status === "BLOCKED") return { ok: false, message: `Δεν δημοσιεύτηκε: ${(d.reasons ?? []).join(" · ") || "το ακίνητο δεν πληροί τους όρους του portal."}` };
  if (d.status === "FAILED") {
    const f = d as unknown as { message: string; needsReview: boolean };
    return { ok: false, message: `Αποτυχία: ${f.message} ${f.needsReview ? "Χρειάζεται έλεγχος πριν ξαναδοκιμάσετε." : "Μπορείτε να πατήσετε «Επανάληψη»."}` };
  }
  if (d.status === "PREVIEWED") return { ok: true, message: d.mock ? "Προεπισκόπηση (mock)· δεν στάλθηκε τίποτα." : "Προεπισκόπηση· δεν στάλθηκε τίποτα.", preview: d };
  const mockNote = d.mock ? " (mock — δεν έγινε επικοινωνία με πραγματικό portal)" : "";
  return { ok: true, message: `${DONE_TEXT[d.status] ?? "Ολοκληρώθηκε."}${mockNote}` };
}
