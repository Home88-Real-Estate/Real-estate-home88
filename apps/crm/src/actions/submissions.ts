"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

function num(formData: FormData, key: string): number | null | undefined {
  const raw = str(formData, key);
  if (raw === undefined) return undefined;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** Status, assignment and notes for one submission. */
export async function updateSubmission(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id") ?? "";
  const status = str(formData, "status");
  const assignedToId = formData.get("assignToMe") === "1" ? str(formData, "me") : undefined;
  const result = await apiFetch(`/api/submissions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: { ...(status ? { status } : {}), ...(assignedToId ? { assignedToId } : {}), ...(str(formData, "note") ? { note: str(formData, "note") } : {}) },
  });
  if (!result.ok) return { ok: false, message: result.error.message, fields: result.error.fields };
  revalidatePath(`/submissions/${id}`);
  revalidatePath("/submissions");
  return { ok: true, message: "Η υποβολή ενημερώθηκε." };
}

/**
 * Creates a property from the submission (the agent has already reviewed and
 * edited the prepopulated fields) or links it to an existing one. Photos are
 * attached, never copied; nothing is published.
 */
export async function convertSubmission(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id") ?? "";
  const mode = str(formData, "mode") === "link" ? "link" : "create";
  const mediaIds = formData.getAll("mediaId").map(String);

  let propertyId: string | undefined;
  if (mode === "link") {
    const reference = (str(formData, "propertyReference") ?? "").toUpperCase();
    if (!reference) return { ok: false, message: "Δώστε τον κωδικό του ακινήτου." };
    const found = await apiFetch<{ data: Array<{ id: string; reference: string }> }>("/api/properties", { query: { q: reference, limit: 5 } });
    const match = found.ok ? found.data.data.find((p) => p.reference === reference) : undefined;
    if (!match) return { ok: false, message: "Δεν βρέθηκε ακίνητο με αυτόν τον κωδικό." };
    propertyId = match.id;
  }

  const result = await apiFetch<{ propertyId: string }>(`/api/submissions/${encodeURIComponent(id)}/convert`, {
    method: "POST",
    json: {
      mode,
      ...(propertyId ? { propertyId } : {}),
      mediaIds,
      ...(mode === "create"
        ? {
            overrides: {
              ...(str(formData, "titleEl") ? { titleEl: str(formData, "titleEl") } : {}),
              ...(str(formData, "descriptionEl") ? { descriptionEl: str(formData, "descriptionEl") } : {}),
              ...(num(formData, "price") !== undefined ? { price: num(formData, "price") } : {}),
              ...(num(formData, "area") !== undefined ? { area: num(formData, "area") } : {}),
              ...(num(formData, "bedrooms") !== undefined ? { bedrooms: num(formData, "bedrooms") } : {}),
              ...(str(formData, "city") ? { city: str(formData, "city") } : {}),
              ...(str(formData, "neighborhood") ? { neighborhood: str(formData, "neighborhood") } : {}),
            },
          }
        : {}),
    },
  });
  if (!result.ok) return { ok: false, message: result.error.message, fields: result.error.fields };
  revalidatePath("/submissions");
  redirect(`/properties/${result.data.propertyId}`);
}

export async function markNotificationsRead(): Promise<void> {
  await apiFetch("/api/notifications/read", { method: "POST", json: {} });
  revalidatePath("/submissions");
}
