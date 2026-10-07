"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { readPropertyForm, str, type ActionState } from "@/lib/form";

type SavedProperty = { property: { id: string } };

/**
 * Create or update, depending on whether an `id` is present. One action keeps
 * the form component identical for both pages and lets the API own validation.
 */
export async function saveProperty(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const payload = readPropertyForm(formData);

  const result = id
    ? await apiFetch<SavedProperty>(`/api/properties/${id}`, { method: "PATCH", json: payload })
    : await apiFetch<SavedProperty>("/api/properties", { method: "POST", json: payload });

  if (!result.ok) {
    return { ok: false, message: result.error.message, fields: result.error.fields };
  }

  const savedId = result.data.property.id;
  revalidatePath("/properties");
  revalidatePath(`/properties/${savedId}`);
  redirect(`/properties/${savedId}`);
}

export type CreateResult = ActionState & { propertyId?: string };

/**
 * Creates a property and returns its id instead of redirecting, so the browser
 * can then upload the photos the agent picked on the form to the new property.
 * (The upload needs the id, and a redirect would leave the page first.)
 */
export async function createPropertyForUpload(formData: FormData): Promise<CreateResult> {
  const result = await apiFetch<SavedProperty>("/api/properties", { method: "POST", json: readPropertyForm(formData) });
  if (!result.ok) return { ok: false, message: result.error.message, fields: result.error.fields };
  revalidatePath("/properties");
  return { ok: true, propertyId: result.data.property.id };
}

/**
 * Ask the API to move a property to another status. The API decides whether
 * the move is allowed (lifecycle + permissions) and records the history.
 */
export async function changePropertyStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const status = str(formData, "status");
  if (!id || !status) return { ok: false, message: "Λείπει το ακίνητο ή η κατάσταση." };

  const result = await apiFetch<SavedProperty>(`/api/properties/${id}/status`, {
    method: "POST",
    json: { status, reason: str(formData, "reason") },
  });
  if (!result.ok) {
    return { ok: false, message: result.error.message, fields: result.error.fields };
  }

  revalidatePath("/properties");
  revalidatePath(`/properties/${id}`);
  return { ok: true, message: "Η κατάσταση ενημερώθηκε." };
}

/** Replaces a property's internal tags, then lets the API re-judge its portal listings. */
export async function savePropertyTags(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id") ?? "";
  const result = await apiFetch(`/api/properties/${encodeURIComponent(id)}/tags`, {
    method: "PUT",
    json: { codes: formData.getAll("tag").map(String) },
  });
  if (!result.ok) return { ok: false, message: result.error.message, fields: result.error.fields };
  revalidatePath(`/properties/${id}`);
  revalidatePath("/properties");
  return { ok: true, message: "Οι ετικέτες αποθηκεύτηκαν και τα portals ελέγχθηκαν ξανά." };
}
