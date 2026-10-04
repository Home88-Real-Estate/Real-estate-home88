"use server";

/** Owners and valuations: every action forwards to the API, which authorises, validates and records the timeline. */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { str, type ActionState } from "@/lib/form";

function fail(error: { message: string; fields?: Record<string, string[]> }): ActionState {
  return { ok: false, message: error.message, fields: error.fields };
}

const SELLER_FIELDS = [
  "listingType", "propertyType", "city", "areaName", "address", "area", "bedrooms", "floor", "yearBuilt",
  "condition", "askingPrice", "motivation", "timeframe", "source", "nextFollowUpAt", "notes",
] as const;
const SUBJECT_FIELDS = ["propertyType", "city", "areaName", "area", "bedrooms", "floor", "yearBuilt", "condition"] as const;

const pickFields = (fd: FormData, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, str(fd, k) ?? ""]));

function refreshSeller(id?: string) {
  revalidatePath("/sellers");
  if (id) revalidatePath(`/sellers/${id}`);
}
function refreshValuation(id?: string) {
  revalidatePath("/valuations");
  if (id) revalidatePath(`/valuations/${id}`);
}

// --- Owners -----------------------------------------------------------------------

export async function createSeller(_p: ActionState, fd: FormData): Promise<ActionState> {
  const result = await apiFetch<{ seller: { id: string } }>("/api/sellers", {
    method: "POST",
    json: {
      ...pickFields(fd, SELLER_FIELDS),
      contactReference: str(fd, "contactReference") ?? "",
      firstName: str(fd, "firstName") ?? "",
      lastName: str(fd, "lastName") ?? "",
      phone: str(fd, "phone") ?? "",
      email: str(fd, "email") ?? "",
      propertyReference: str(fd, "propertyReference") ?? "",
    },
  });
  if (!result.ok) return fail(result.error);
  refreshSeller();
  redirect(`/sellers/${result.data.seller.id}`);
}

export async function updateSeller(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/sellers/${encodeURIComponent(id)}`, { method: "PATCH", json: pickFields(fd, SELLER_FIELDS) });
  if (!result.ok) return fail(result.error);
  refreshSeller(id);
  return { ok: true, message: "Αποθηκεύτηκε." };
}

export async function moveSeller(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/sellers/${encodeURIComponent(id)}/stage`, {
    method: "POST",
    json: { stage: str(fd, "stage"), reason: str(fd, "reason") ?? "", propertyReference: str(fd, "propertyReference") ?? "" },
  });
  if (!result.ok) return fail(result.error);
  refreshSeller(id);
  return { ok: true, message: "Το στάδιο άλλαξε." };
}

export async function linkSellerProperty(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/sellers/${encodeURIComponent(id)}/property`, { method: "POST", json: { propertyReference: str(fd, "propertyReference") ?? "" } });
  if (!result.ok) return fail(result.error);
  refreshSeller(id);
  return { ok: true, message: "Το ακίνητο συνδέθηκε." };
}

export async function addSellerNote(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/sellers/${encodeURIComponent(id)}/notes`, { method: "POST", json: { text: str(fd, "text") ?? "" } });
  if (!result.ok) return fail(result.error);
  refreshSeller(id);
  return { ok: true, message: "Η σημείωση καταγράφηκε." };
}

// --- Valuations -------------------------------------------------------------------

export async function createValuation(_p: ActionState, fd: FormData): Promise<ActionState> {
  const result = await apiFetch<{ valuation: { id: string } }>("/api/valuations", {
    method: "POST",
    json: {
      ...pickFields(fd, SUBJECT_FIELDS),
      listingType: str(fd, "listingType") ?? undefined,
      propertyReference: str(fd, "propertyReference") ?? "",
      sellerLeadId: str(fd, "sellerLeadId") ?? "",
    },
  });
  if (!result.ok) return fail(result.error);
  refreshValuation();
  const seller = str(fd, "sellerLeadId");
  if (seller) refreshSeller(seller);
  redirect(`/valuations/${result.data.valuation.id}`);
}

export async function updateValuationSubject(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/valuations/${encodeURIComponent(id)}`, { method: "PATCH", json: pickFields(fd, SUBJECT_FIELDS) });
  if (!result.ok) return fail(result.error);
  refreshValuation(id);
  return { ok: true, message: "Αποθηκεύτηκε." };
}

export async function addInternalComparable(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  await apiFetch(`/api/valuations/${encodeURIComponent(id)}/comparables`, {
    method: "POST",
    json: { source: "INTERNAL", kind: str(fd, "kind"), propertyId: str(fd, "propertyId") },
  });
  refreshValuation(id);
}

export async function addExternalComparable(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/valuations/${encodeURIComponent(id)}/comparables`, {
    method: "POST",
    json: {
      source: "EXTERNAL",
      ...pickFields(fd, ["label", "origin", "price", "area", "city", "areaName", "bedrooms", "floor", "yearBuilt", "condition", "observedAt", "adjustmentReason"]),
      adjustmentPct: str(fd, "adjustmentPct") ?? "0",
    },
  });
  if (!result.ok) return fail(result.error);
  refreshValuation(id);
  return { ok: true, message: "Το συγκριτικό προστέθηκε." };
}

export async function updateComparable(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const cid = str(fd, "cid") ?? "";
  const result = await apiFetch(`/api/valuations/${encodeURIComponent(id)}/comparables/${encodeURIComponent(cid)}`, {
    method: "PATCH",
    json: { adjustmentPct: str(fd, "adjustmentPct") ?? "0", adjustmentReason: str(fd, "adjustmentReason") ?? "" },
  });
  if (!result.ok) return fail(result.error);
  refreshValuation(id);
  return { ok: true, message: "Αποθηκεύτηκε." };
}

export async function toggleComparable(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  const cid = str(fd, "cid") ?? "";
  await apiFetch(`/api/valuations/${encodeURIComponent(id)}/comparables/${encodeURIComponent(cid)}`, {
    method: "PATCH",
    json: { included: str(fd, "included") === "true" },
  });
  refreshValuation(id);
}

export async function removeComparable(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  const cid = str(fd, "cid") ?? "";
  await apiFetch(`/api/valuations/${encodeURIComponent(id)}/comparables/${encodeURIComponent(cid)}`, { method: "DELETE" });
  refreshValuation(id);
}

export async function finalizeValuation(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch(`/api/valuations/${encodeURIComponent(id)}/finalize`, {
    method: "POST",
    json: { recommendedPrice: str(fd, "recommendedPrice") ?? "", rationale: str(fd, "rationale") ?? "" },
  });
  if (!result.ok) return fail(result.error);
  refreshValuation(id);
  revalidatePath("/sellers", "layout");
  return { ok: true, message: "Η εκτίμηση οριστικοποιήθηκε." };
}

export async function duplicateValuation(fd: FormData): Promise<void> {
  const id = str(fd, "id") ?? "";
  const result = await apiFetch<{ valuation: { id: string } }>(`/api/valuations/${encodeURIComponent(id)}/duplicate`, { method: "POST", json: {} });
  refreshValuation();
  if (result.ok) redirect(`/valuations/${result.data.valuation.id}`);
}
