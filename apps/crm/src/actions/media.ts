"use server";

import { revalidatePath } from "next/cache";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

function refresh(propertyId: string): void {
  revalidatePath(`/properties/${propertyId}`);
}

/** Upload one or more files. They arrive on the API as `pending_review`. */
export async function uploadMedia(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const propertyId = str(formData, "propertyId");
  if (!propertyId) return { ok: false, message: "Missing property." };

  const files = formData
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return { ok: false, message: "Choose at least one file." };

  const body = new FormData();
  for (const file of files) body.append("file", file);
  const kind = str(formData, "kind");
  if (kind) body.set("kind", kind);

  const result = await apiFetch(`/api/properties/${propertyId}/media`, {
    method: "POST",
    form: body,
  });
  if (!result.ok) return { ok: false, message: result.error.message, fields: result.error.fields };

  refresh(propertyId);
  return { ok: true, message: `${files.length} file(s) uploaded for review.` };
}

/** Edit alt text, kind or primary flag. */
export async function updateMedia(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const propertyId = str(formData, "propertyId");
  const mediaId = str(formData, "mediaId");
  if (!propertyId || !mediaId) return { ok: false, message: "Missing media." };

  const payload: Record<string, unknown> = {};
  if (formData.has("altEl")) payload.altEl = formData.get("altEl");
  if (formData.has("altEn")) payload.altEn = formData.get("altEn");
  const kind = str(formData, "kind");
  if (kind) payload.kind = kind;

  const result = await apiFetch(`/api/properties/${propertyId}/media/${mediaId}`, {
    method: "PATCH",
    json: payload,
  });
  if (!result.ok) return { ok: false, message: result.error.message, fields: result.error.fields };

  refresh(propertyId);
  return { ok: true, message: "Saved." };
}

/** The primary item is the one the public site and feeds use as the cover. */
export async function makePrimary(formData: FormData): Promise<void> {
  const propertyId = str(formData, "propertyId");
  const mediaId = str(formData, "mediaId");
  if (!propertyId || !mediaId) return;

  await apiFetch(`/api/properties/${propertyId}/media/${mediaId}`, {
    method: "PATCH",
    json: { isPrimary: true },
  });
  refresh(propertyId);
}

/** Manager-only moderation decision. */
export async function setMediaStatus(formData: FormData): Promise<void> {
  const propertyId = str(formData, "propertyId");
  const mediaId = str(formData, "mediaId");
  const status = str(formData, "status");
  if (!propertyId || !mediaId || !status) return;

  await apiFetch(`/api/properties/${propertyId}/media/${mediaId}/status`, {
    method: "POST",
    json: { status },
  });
  refresh(propertyId);
}

export async function deleteMedia(formData: FormData): Promise<void> {
  const propertyId = str(formData, "propertyId");
  const mediaId = str(formData, "mediaId");
  if (!propertyId || !mediaId) return;

  await apiFetch(`/api/properties/${propertyId}/media/${mediaId}`, { method: "DELETE" });
  refresh(propertyId);
}
