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
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidatePath(`/properties/${id}`);
  revalidatePath("/properties");
  return { ok: true, message: "Οι ετικέτες αποθηκεύτηκαν και τα portals ελέγχθηκαν ξανά." };
}

/**
 * Soft delete: the API moves the listing to the deleted folder, where it stays
 * until someone restores it or removes it permanently.
 */
async function moveToDeletedFolder(id: string): Promise<ActionState> {
  const result = await apiFetch<SavedProperty>(`/api/properties/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/properties");
  revalidatePath(`/properties/${id}`);
  return { ok: true, message: "Το ακίνητο μεταφέρθηκε στα «Διαγραμμένα»." };
}

/** Out of the bin: a plain status change back to draft, decided by the API. */
async function restoreFromDeletedFolder(id: string): Promise<ActionState> {
  const result = await apiFetch<SavedProperty>(`/api/properties/${encodeURIComponent(id)}/status`, {
    method: "POST",
    json: { status: "DRAFT" },
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/properties");
  revalidatePath(`/properties/${id}`);
  return { ok: true, message: "Το ακίνητο επανήλθε ως Πρόχειρο." };
}

/**
 * Permanent removal of a row that is already in the deleted folder. The API
 * decides (administrator only, never for a property with transactions); on
 * success there is no page left to show, so the browser lands back in the bin.
 */
async function removePermanently(id: string): Promise<ActionState> {
  const result = await apiFetch(`/api/properties/${encodeURIComponent(id)}/permanent`, {
    method: "DELETE",
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/properties");
  redirect("/properties?statusGroup=DELETED");
}

export async function deleteProperty(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, message: "Λείπει το ακίνητο." };
  return moveToDeletedFolder(id);
}

export async function permanentlyDeleteProperty(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, message: "Λείπει το ακίνητο." };
  return removePermanently(id);
}

/**
 * The list row's actions: delete (to the bin), restore (out of the bin) or
 * remove permanently. One form keeps the row tidy; the API re-checks every
 * request, so the buttons are only hints.
 */
export async function rowPropertyAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id");
  const op = str(formData, "op");
  if (!id) return { ok: false, message: "Λείπει το ακίνητο." };

  if (op === "delete") return moveToDeletedFolder(id);
  if (op === "restore") return restoreFromDeletedFolder(id);
  if (op === "permanent") return removePermanently(id);
  return { ok: false, message: "Άγνωστη ενέργεια." };
}
