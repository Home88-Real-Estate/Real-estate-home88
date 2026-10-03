"use server";

/**
 * Reminders, viewings and requests. Each action passes the form to the API,
 * which validates and authorises; errors come back field by field.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

function fail(error: { message: string; fields?: Record<string, string[]> }): ActionState {
  return { ok: false, message: error.message, fields: error.fields };
}

// --- Reminders ---------------------------------------------------------------

export async function createTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await apiFetch("/api/tasks", {
    method: "POST",
    json: {
      title: str(formData, "title") ?? "",
      description: str(formData, "description"),
      priority: str(formData, "priority") ?? "NORMAL",
      dueAt: str(formData, "dueAt"),
      leadId: str(formData, "leadId"),
      propertyId: str(formData, "propertyId"),
    },
  });
  if (!result.ok) return fail(result.error);
  revalidatePath("/reminders");
  revalidatePath("/");
  return { ok: true, message: "Η υπενθύμιση δημιουργήθηκε." };
}

/** Plain form action (no state): complete, reopen or cancel a reminder. */
export async function setTaskStatus(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const status = str(formData, "status");
  if (!id || !status) return;
  await apiFetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", json: { status } });
  revalidatePath("/reminders");
  revalidatePath("/");
}

// --- Viewings ----------------------------------------------------------------

export async function createViewing(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await apiFetch("/api/viewings", {
    method: "POST",
    json: {
      propertyReference: str(formData, "propertyReference") ?? "",
      clientName: str(formData, "clientName") ?? "",
      clientPhone: str(formData, "clientPhone"),
      clientEmail: str(formData, "clientEmail"),
      startsAt: str(formData, "startsAt") ?? "",
      durationMinutes: str(formData, "durationMinutes") ?? "30",
    },
  });
  if (!result.ok) return fail(result.error);
  revalidatePath("/calendar");
  revalidatePath("/");
  return { ok: true, message: "Το ραντεβού καταχωρίστηκε." };
}

export async function setViewingStatus(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const status = str(formData, "status");
  if (!id || !status) return;
  await apiFetch(`/api/viewings/${encodeURIComponent(id)}`, { method: "PATCH", json: { status } });
  revalidatePath("/calendar");
  revalidatePath("/");
}

// --- Requests ----------------------------------------------------------------

function readRequestForm(formData: FormData): Record<string, unknown> {
  const list = (name: string) => formData.getAll(name).map(String).filter(Boolean);
  const areas = (str(formData, "areas") ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    listingType: str(formData, "listingType") ?? "SALE",
    propertyTypes: list("propertyTypes"),
    areas,
    minPrice: str(formData, "minPrice") ?? "",
    maxPrice: str(formData, "maxPrice") ?? "",
    minArea: str(formData, "minArea") ?? "",
    maxArea: str(formData, "maxArea") ?? "",
    minBedrooms: str(formData, "minBedrooms") ?? "",
    minBathrooms: str(formData, "minBathrooms") ?? "",
    minFloor: str(formData, "minFloor") ?? "",
    minYearBuilt: str(formData, "minYearBuilt") ?? "",
    features: list("features"),
    clientName: str(formData, "clientName") ?? "",
    clientPhone: str(formData, "clientPhone") ?? "",
    clientEmail: str(formData, "clientEmail") ?? "",
    rating: str(formData, "rating") ?? "",
    notes: str(formData, "notes") ?? "",
    expiresAt: str(formData, "expiresAt") ?? "",
  };
}

export async function saveRequest(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = str(formData, "id");
  const payload = readRequestForm(formData);
  const result = id
    ? await apiFetch<{ request: { id: string } }>(`/api/requests/${encodeURIComponent(id)}`, { method: "PATCH", json: payload })
    : await apiFetch<{ request: { id: string } }>("/api/requests", { method: "POST", json: payload });
  if (!result.ok) return fail(result.error);
  revalidatePath("/requests");
  redirect(`/requests/${result.data.request.id}`);
}

export async function setRequestStatus(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const status = str(formData, "status");
  if (!id || !status) return;
  await apiFetch(`/api/requests/${encodeURIComponent(id)}`, { method: "PATCH", json: { status } });
  revalidatePath("/requests");
  revalidatePath(`/requests/${id}`);
}
