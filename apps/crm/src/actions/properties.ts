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

/** Archive (soft delete). The API route requires ADMIN. */
export async function archiveProperty(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  if (id) {
    await apiFetch(`/api/properties/${id}`, { method: "DELETE" });
  }
  revalidatePath("/properties");
  redirect("/properties");
}
